let xScale = 2;
let yScale = 10;

async function renderPlayers() {
    const simple = currentPlayerCache.map((player) => {
        const teamId = player.data.leagueTeamId || player.data.tournamentTeamId || player.teamId || "null";
        let shadow = false;
        const team = teamCache.find((t) => t.id === teamId);
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
    const grouped = _.groupBy(simple, "teamId");
    const teams = Object.entries(grouped).map(([key, value]) => {
        const teamName = getTeamName(key);
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

    const divisions = _.chain(teams)
        .map((t) => { return { team: t, division: getTeamDivision(t.teamId)}})
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

function drawTimeline(days) {
    let timeline = $("#timeline")[0];
    const height = timeline.height;
    let ctx = timeline.getContext('2d');

    ctx.fillStyle = 'rgb(50, 50, 50)';
    for(let i = 0; i < days*xScale; i+=(10*xScale)) {
        ctx.fillRect(i, height-20, 1, 20);
    }

    let daysSoFar = 0;
    seasonCache.forEach((season) => {
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
    let firstDay = toAbsoluteDay(getNearestDay(new Date(first.validFrom)));
    ctx.fillRect(0, 0, firstDay*xScale, height);

    let daymap = mods
        .map((m) => {
            return {
                attr: m.attr,
                appearances: m.appearances.map((a) => {
                    let end = toAbsoluteDay(getNearestDay(new Date()));
                    if(a.end !== undefined) {
                        end = toAbsoluteDay(getNearestDay(new Date(a.end)));
                    }
                    return {
                        start: toAbsoluteDay(getNearestDay(new Date(a.start))),
                        end: end
                    };
                })
            };
        })

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

function addPlayer(id) {
    let player = currentPlayerCache.find((p) => p.id === id);
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

    drawMods(id, totalDays);
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

let totalDays = 0;
let playerDataRender = {};

let smallerCachePromise = initCaches();
let playerCachePromise = initCurrentPlayersCache();
let allCachePromise = Promise.all([smallerCachePromise, playerCachePromise]);

smallerCachePromise.then(() => {
    totalDays = seasonCache
        .map((s) => s.days)
        .reduce((s1, s2) => s1 + s2);
    console.log(totalDays);

    $("#timeline-render").html($.render.timelineTmpl({width: (totalDays * xScale)+20}));
    drawTimeline(totalDays);
    
    // playerTest = playerTest.map((p) => {
    //     p.width = totalDays * xScale;
    //     return p;
    // });
    
    // $("#player-mods").html($.render.modViewTmpl(playerTest));
    // let scroll = $("#scroll2")
    // scroll.prop('scrollLeft', scroll.prop('scrollWidth'));
    // playerTest.forEach((p) => drawMods(p.playerId, totalDays));

    // playerTest.forEach((p) => addPlayer(p.playerId));
});

allCachePromise.then(() => {
    renderPlayers().then((realData) => {
        playerDataRender = realData;
        $("#playerlist").html($.render.allPlayersTmpl(playerDataRender));
    });
});
