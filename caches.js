const leagueId = "d8545021-e9fc-48a3-af74-48685950a183";

const dbPromise = idb.openDB("blaseball-modtracker", 1, {
    upgrade(db) {
        const versionStore = db.createObjectStore('player-versions', {
            keyPath: ['entityId', 'validFrom']
        });
        versionStore.createIndex('entityId', 'entityId');
        versionStore.createIndex('validFrom', 'validFrom');
    }
});

const teamsPromise = (async () => {
    return (await $.getJSON(
        "https://api.sibr.dev/chronicler/v1/teams"
    )).data;
})();

const divisionsPromise = (async () => {
    const subleagueIds = (await $.getJSON(
        "https://api.sibr.dev/chronicler/v2/entities",
        {
            type: "league",
            id: leagueId
        }
    )).items[0].data.subleagues;

    const divisionIds = (await $.getJSON(
        "https://api.sibr.dev/chronicler/v2/entities",
        {
            type: "subleague",
            id: subleagueIds.join()
        }
    )).items.flatMap((info) => info.data.divisions);

    return (await $.getJSON(
        "https://api.sibr.dev/chronicler/v2/entities",
        {
            type: "division",
            id: divisionIds.join()
        }
    )).items;
})();

const timeMapPromise = (async () => {
    return (await $.getJSON("https://api.sibr.dev/chronicler/v1/time/map")).data;
})();

const seasonsPromise = (async () => {
    return (await $.getJSON("https://api.sibr.dev/chronicler/v1/time/seasons")).data;
})();

const exTimeMapPromise = (async () => {
    const timeMap = await timeMapPromise;
    const seasons = await seasonsPromise;

    let exTimeMap = extrapolateSeason(seasons[0])
        .concat(extrapolateSeason(seasons[1], 97))
        .concat(timeMap);

    let ccStart = exTimeMap.findIndex((d) => d.season === 10 && d.tournament === 0 && d.day === 119);
    exTimeMap[ccStart].tournament = -1;
    let ccStart2 = exTimeMap.findIndex((d) => d.season === 10 && d.tournament === 0 && d.day === 119);
    exTimeMap[ccStart2].day = 0;

    let ccEnd = _.findLastIndex(exTimeMap, (d) => d.season === 10 && d.tournament === -1 && d.day === -1);
    exTimeMap[ccEnd].tournament = 0;
    exTimeMap[ccEnd].day = 15;

    return exTimeMap;
})();

const currentPlayersPromise = (async () => {
    return (await $.getJSON("https://api.sibr.dev/chronicler/v1/players")).data;
})();

const totalDaysPromise = (async () => {
    return (await seasonsPromise)
        .map((s) => s.days)
        .reduce((s1, s2) => s1 + s2);
})();

// divisionPromise.then((teams) => {
//     console.log(teams);
// });

async function getTeamName(id) {
    const teams = (await teamsPromise).map((team) => team.data );
    const team = teams.find((t) => t.id === id)
    if(team !== undefined) {
        return team.fullName
    } else {
        return "null"
    }
}

async function getTeamDivision(id) {
    const divisions = (await divisionsPromise).map((d) => d.data)
    const division = divisions.find((d) => d.teams.includes(id));
    if(division !== undefined) {
        return {
            divisionId: division.id,
            divisionName: division.name
        };
    } else {
        return {
            divisionId: "null-division",
            divisionName: "Other"
        }
    }
}

async function getNearestDay(date) {
    const exTimeMap = (await exTimeMapPromise);
    let sorted = [...exTimeMap].sort((a, b) => {
        let aDate = new Date(a.startTime);
        let bDate = new Date(b.startTime);
        let aComp = Math.abs(date - aDate);
        let bComp = Math.abs(date - bDate);
        return aComp - bComp;
    })

    let before = sorted.filter((d) => {
        return new Date(d.startTime) - date < 0;
    })
    if(before.length !== 0) {
        return before[0]
    } else {
        return sorted[0];
    }
}

async function toAbsoluteDay(seasonDay) {
    const seasons = (await seasonsPromise);
    let daysBeforeSeason = seasons
        .filter((season) => {
            if(season.season < seasonDay.season) {
                return true;
            } else if(season.season == seasonDay.season) {
                return season.tournament < seasonDay.tournament;
            } else {
                return false;
            }
        })
        .map((season) => season.days)
        .reduce((a, b) => a + b);
    
    return daysBeforeSeason + seasonDay.day;
}

function extrapolateSeason(season, until) {
    if(until === undefined) {
        until = season.days - 1;
    }

    let start = season.seasonStartTime;
    let days = [];

    days.push({
        season: season.season,
        tournament: season.tournament,
        day: 0,
        type: "preseason",
        startTime: season.startTime,
        endTime: start
    });

    for(let i = 0; (i < 99 && i <= until); i++) {
        days.push({
            season: season.season,
            tournament: season.tournament,
            day: i,
            type: "season",
            startTime: new Date(new Date(start).getTime() + (60 * 60 * 1000 * i)).toISOString(),
            endTime: new Date(new Date(start).getTime() + (60 * 60 * 1000 * (i + 1))).toISOString()
        });
    }

    for(let i = 99; (i < season.days && i <= until); i++) {
        days.push({
            season: season.season,
            tournament: season.tournament,
            day: i,
            type: "postseason",
            startTime: new Date(new Date(start).getTime() + (60 * 60 * 1000 * i)).toISOString(),
            endTime: new Date(new Date(start).getTime() + (60 * 60 * 1000 * (i + 1))).toISOString()
        });
    }

    if(until >= season.days - 1) {
        days.push({
            season: season.season,
                tournament: season.tournament,
                day: season.days - 1,
                type: "post_election",
                startTime: new Date(new Date(start).getTime() + (60 * 60 * 1000 * (season.days - 1))).toISOString(),
                endTime: season.endTime
        });
    }
    
    return days;
}

async function getPlayerVersions(id) {
    let current = (await $.getJSON(
        "https://api.sibr.dev/chronicler/v2/entities",
        {
            type: "player",
            id: id
        }
    )).items[0];

    let db = (await dbPromise);
    let stored = await db.getAllFromIndex('player-versions', 'entityId', id);
    let lastStored = stored[stored.length-1];
    let lastValid = new Date(0).toISOString();
    if(lastStored !== undefined) {
        lastValid = lastStored.validFrom;
    }
    if(lastStored === undefined || lastValid !== current.validFrom) {
        console.log("getting new versiosn");
        let newVersions = [];
        let incomplete = true;

        let request = {
            url: "https://api.sibr.dev/chronicler/v2/versions",
            data: {
                type: "player",
                id: id,
                after: lastValid
            }
        }
    
        while(incomplete) {
            const response = (await $.getJSON(request));
            newVersions = newVersions.concat(response.items);
            request.data.page = response.nextPage;
            if(response.nextPage === null) {
                incomplete = false;
            }
        }

        const tx = (await dbPromise).transaction('player-versions', 'readwrite');
        await newVersions.map((v) => tx.store.add(v));
        await tx.done;

        return stored.concat(newVersions);
    } else {
        return stored;
    }    
}

async function getPlayerMods(id) {
    let versions = await getPlayerVersions(id);
    let attrVersions = versions
        .map((v) => {
            return {
                id: v.entityId,
                validFrom: v.validFrom,
                attr: {
                    permAttr: v.data.permAttr,
                    seasAttr: v.data.seasAttr,
                    weekAttr: v.data.weekAttr,
                    gameAttr: v.data.gameAttr,
                    itemAttr: v.data.ItemAttr
                }
            }
        })
        .map((v) => {
            if(v.attr.permAttr === undefined) {
                v.attr.permAttr = [];
            }
            if(v.attr.seasAttr === undefined) {
                v.attr.seasAttr = [];
            }
            if(v.attr.weekAttr === undefined) {
                v.attr.weekAttr = [];
            }
            if(v.attr.gameAttr === undefined) {
                v.attr.gameAttr = [];
            }
            if(v.attr.itemAttr === undefined) {
                v.attr.itemAttr = [];
            }
            return v;
        })
        .map((v) => {
            return {
                id: v.id,
                validFrom: v.validFrom,
                attr: _.uniq(Object.values(v.attr).flat())
            }
        })
    
    let changeVersions = [attrVersions[0]];

    attrVersions.forEach((v) => {
        if(JSON.stringify(v.attr) !== JSON.stringify(changeVersions[changeVersions.length - 1].attr)) {
            changeVersions.push(v);
        }
    })


    let listOfAttr = _.uniq(changeVersions.flatMap((v) => v.attr));

    let histories = listOfAttr
        .map((attr) => {
            let attrChanged = [];
            let attrPresent = false;
            changeVersions.forEach((v) => {
                if(attrPresent) {
                    if(!v.attr.includes(attr)) {
                        attrChanged[attrChanged.length-1].end = v.validFrom;
                        attrPresent = false;
                    }
                } else {
                    if(v.attr.includes(attr)) {
                        attrChanged.push({
                            start: v.validFrom
                        });
                        attrPresent = true;
                    }
                }
            });
            return {
                attr: attr,
                appearances: attrChanged
            };
        });
    
    return [...histories];
}

async function getPlayerFirstVersion(id) {
    let versions = await getPlayerVersions(id);
    versions.sort((a, b) => new Date(a.validFrom) - new Date(b.validFrom));
    return versions[0];
}

