let xScale = 2;
let yScale = 10;

async function renderPlayers() {
    const simplePromises = (await currentPlayersPromise).map(async (player) => {
        const teamId = player.data.leagueTeamId || player.data.tournamentTeamId || player.teamId || "null";
        let shadow = false;
        const team = (await teamsPromise).find((t) => t.id === teamId);
        if(team !== undefined) {
            shadow = team.data.shadows.includes(player.id);
        }
        return { 
            id: player.id,
            teamId: teamId,
            name: player.data.name,
            shadow: shadow,
            forbidden: player.forbidden,
            deceased: player.data.deceased,
            dust: (player.data.permAttr || []).includes("DUST")
        };
    });
    const simple = await Promise.all(simplePromises);
    const grouped = _.groupBy(simple, "teamId");
    const teamPromises = Object.entries(grouped).map(async ([key, value]) => {
        const teamName = await getTeamName(key);
        let players = [...value];
        players.sort((a, b) => {
            return (a.deceased * 4 + a.dust * 2 + a.shadow) - (b.deceased * 4 + b.dust * 2 + b.shadow);
        });
        return {
            teamId: key,
            teamName: teamName,
            players: players
        };
    });
    const teams = await Promise.all(teamPromises);

    const divisionMapPromises = teams.map(async (t) => {
        return {
            team: t,
            division: await getTeamDivision(t.teamId)
        };
    });
    const divisionMap = await Promise.all(divisionMapPromises)

    const divisions = _.chain(divisionMap)
        .groupBy((i) => i.division.divisionId)
        .map((teams, division) => {
            return {
                divisionId: division,
                divisionName: teams[0].division.divisionName,
                teams: teams.map((t) => t.team)
            }
        })
        .value();

    const realDivisions = divisions.filter((d) => d.divisionId !== "null-division");
    const otherDivision = divisions.find((d) => d.divisionId === "null-division");

    return {
        divisions: realDivisions,
        others: otherDivision
    };
}

async function drawTimeline(days) {
    let timeline = $("#timeline")[0];
    const height = timeline.height;
    let ctx = timeline.getContext('2d');

    ctx.fillStyle = 'rgb(50, 50, 50)';
    for(let i = 0; i < days*xScale; i+=(10*xScale)) {
        ctx.fillRect(i, height-20, 1, 20);
    }

    let daysSoFar = 0;
    (await seasonsPromise).forEach((season) => {
        ctx.fillRect(daysSoFar*xScale, height-50, 1, 50);
        ctx.fillText("S" + (season.season+1), daysSoFar*xScale, 20);
        daysSoFar += season.days
    });
}

async function drawMods(id, days) {
    let el = $("#mods-" + id);
    let chart = el[0];
    let ctx = chart.getContext('2d');

    let mods = await getPlayerMods(id);
    let first = await getPlayerFirstVersion(id);

    const height = mods.length * yScale

    el.prop('width', days * xScale);
    el.prop('height', height);

    ctx.fillStyle = "rgb(30, 30, 30)";
    let firstDay = toAbsoluteDay(await getNearestDay(new Date(first.validFrom)));
    ctx.fillRect(0, 0, firstDay*xScale, height);

    let daymapPromises = mods
        .map(async (m) => {
            const appearancePromises = m.appearances.map(async (a) => {
                let end = toAbsoluteDay(await getNearestDay(new Date()));
                if(a.end !== undefined) {
                    end = await toAbsoluteDay(await getNearestDay(new Date(a.end)));
                }
                return {
                    start: await toAbsoluteDay(await getNearestDay(new Date(a.start))),
                    end: end
                };
            });
            const appearances = await Promise.all(appearancePromises);
            return {
                attr: m.attr,
                appearances: appearances
            };
        });
    
    let daymap = await Promise.all(daymapPromises);

    for(let i = 0; i < daymap.length; i++) {
        const y = i * yScale;
        let r = Math.random()*255;
        let g = Math.random()*255;
        let b = Math.random()*255;
        ctx.fillStyle = "rgb(" + r + "," + g + "," + b + ")";
        daymap[i].appearances.forEach((a) => {
            ctx.fillRect(a.start*xScale, y, (a.end - a.start + 1)*xScale, yScale);
        })
    }

    let tooltip = tippy('#mods-'+id, {
        content: "test",
        followCursor: true,
        allowHTML: true
    })[0];
    // tooltip.disable();

    el.mousemove((event) => {
        tooltip.setContent("<ul><li>day: " + Math.round(event.offsetX/xScale) + "</li><li>mod: " + daymap[Math.floor(event.offsetY/yScale)].attr + "</li></ul>");
    });
}

async function addPlayer(id) {
    let player = (await currentPlayersPromise).find((p) => p.id === id);
    let totalDays = (await totalDaysPromise)
    let render = $.render.modViewTmpl({
        playerId: id,
        playerName: player.data.name,
        width: totalDays * xScale
    });

    let modDiv = $("#player-mods")

    modDiv.append(render);

    $("#remove-"+id).click((e) => removePlayer(id));
    $("#unadd-"+id).attr('hidden', false);
    $("#add-"+id).attr('hidden', true);

    if(modDiv.children().length === 1) {
        let scroll = $("#scroll2")
        scroll.prop('scrollLeft', scroll.prop('scrollWidth'));
    }

    await drawMods(id, totalDays);
    updateCacheIcon();
}

function removePlayer(id) {
    $("#card-"+id).remove();
    $("#unadd-"+id).attr('hidden', true);
    $("#add-"+id).attr('hidden', false);
}

$(".remove-player").click()

let playerTest = [
    {
        playerId: "20be1c34-071d-40c6-8824-dde2af184b4d",
        playerName: "Qais Dogwalker",
    },
    {
        playerId: "b348c037-eefc-4b81-8edd-dfa96188a97e",
        playerName: "Lowe Forbes",
    },
    {
        playerId: "5bcfb3ff-5786-4c6c-964c-5c325fcc48d7",
        playerName: "Paula Turnip"
    },
    {
        playerId: "d1a198d6-b05a-47cf-ab8e-39a6fa1ed831",
        playerName: "Liquid Friend"
    }
]

$.templates("allPlayersTmpl", {
    markup: "#allPlayersTmpl",
    templates: {
        divisionTmpl: "#divisionTmpl",
        teamTmpl: "#teamTmpl",
    }
});

$.templates("timelineTmpl", {
    markup: "#timelineTmpl"
});

$.templates("modViewTmpl", {
    markup: "#modViewTmpl"
});

const playerDataRenderPromise = renderPlayers();

totalDaysPromise.then((totalDays) => {
    console.log(totalDays);
    $("#timeline-render").html($.render.timelineTmpl({width: (totalDays * xScale)+20}));
    drawTimeline(totalDays);
})

async function applyFilters() {
    let playerDataRender = await playerDataRenderPromise;
    let allDivisions = playerDataRender.divisions.concat(playerDataRender.others);
    
    allDivisions.forEach((d) => {
        let teamsShow = d.teams.map((t) => {
            let playersShow = t.players.map((p) => {
                let show = true;
                if(!$("#forbidden-check").prop('checked')) {
                    if(p.forbidden) {
                        show = false;
                    }
                }
        
                let search = $("#searchbox").val().toLowerCase();
                if(search.length !== 0) {
                    if(!p.name.toLowerCase().includes(search) && !p.id.toLowerCase().startsWith(search)) {
                        show = false;
                    }
                }
        
                $("#player-list-"+p.id).attr('hidden', !show);

                return show;
            });
            let show = !playersShow.every((p) => !p);
            $("#team-"+t.teamId).attr('hidden', !show);
            return show;
        });;
        let show = !teamsShow.every((t) => !t);
        $("#division-"+d.divisionId).attr('hidden', !show);
    })
}

async function updateCacheIcon() {
    let playerDataRender = await playerDataRenderPromise;
    let allDivisions = playerDataRender.divisions.concat(playerDataRender.others);
    let players = allDivisions
        .flatMap((d) => d.teams)
        .flatMap((t) => t.players);
    
    let promises = players.map(async (p) => {
        let cached = await isPlayerCached(p.id);
        $("#cache-"+p.id).attr('hidden', !cached);
    });

    return await Promise.all(promises);
}

playerDataRenderPromise.then((data) => {
    $("#playerlist").html($.render.allPlayersTmpl(data));
    $("#forbidden-check").change(applyFilters);
    $("#searchbox").on('change keyup paste', applyFilters);
    updateCacheIcon();
});
