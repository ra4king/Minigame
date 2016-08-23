var ws = require('ws');

var server = new ws.Server({ port: 8001 }, function() {
    console.log('Websockets server up on port 8001');
});

var PLAYER_RADIUS = 15;
var BULLET_RADIUS = 5;
var ARENA_WIDTH = 800;
var ARENA_HEIGHT = 600;
var MAX_HEALTH = 50;
var TIMESTEP_MS = 20;

var players = [];

var bullets = [];
var totalBulletCount = 0;

var powerups = [];
var lastPowerupSpawnTime = 0;
var currentCooldownTime = 0;

var POWERUP_RADIUS = 5;
var POWERUP_COOLDOWN_MIN = 8 * 1000;
var POWERUP_COOLDOWN_MAX = 15 * 1000;

var POWERUP_SHOOT_FASTER = 1;
var POWERUP_SHOOT_FASTER_TIME = 5 * 1000;

function generatePlayer(id) {
    players[id].x = (ARENA_WIDTH - 20) * Math.random() + 10;
    players[id].y = (ARENA_HEIGHT - 20) * Math.random() + 10;
    players[id].health = MAX_HEALTH;
}

server.on('connection', function(conn) {
    var id = players.length;

    console.log('Player ' + id + ' has connected.');

    conn.on('message', function(msg) {
        try {
            var data = JSON.parse(msg);

            if(players[id] && data.player) {
                if(Math.abs(players[id].x - data.player.x) > 3) {
                    data.player.x = players[id].x;
                    players[id].sendPos = true;
                }
                if(Math.abs(players[id].y - data.player.y) > 3) {
                    data.player.y = players[id].y;
                    players[id].sendPos = true;
                }

                var offset = 25, angleOff = Math.PI / 4;
                var angle = calcAngle(data.player, data.aiming);
                var aimX = data.player.x + offset * Math.cos(angle + angleOff);
                var aimY = data.player.y + offset * Math.sin(angle + angleOff);

                players[id] = Object.assign(players[id], {
                    timestamp: Date.now(),
                    x: data.player.x,
                    y: data.player.y,
                    xdiff: data.player.x - players[id].x,
                    ydiff: data.player.y - players[id].y,
                    pingMsg: data.pingMsg,
                    ping: data.ping,
                    angle: calcAngle({x: aimX, y: aimY}, data.aiming),
                    aiming: data.aiming,
                    shooting: data.shooting,
                });
            } else if(!players[id] && data.name) {
                players[id] = {
                    name: data.name,
                    sendPos: true,
                    conn: conn,
                    bulletsShot: [],
                    score: 0
                };
                generatePlayer(id);
                console.log('Player ' + id + ' has named themselves ' + data.name);
            }
        } catch(e) {
            console.error(e + ' ' + msg);
        }
    });

    conn.on('close', function() {
        players[id] = null;
        console.log('Player ' + id + ' has left.');
    });
});

setInterval(tick, TIMESTEP_MS);

function intersects(center1, radius1, center2, radius2) {
    var xdiff = center2.x - center1.x;
    var ydiff = center2.y - center1.y;
    var distSqr = xdiff * xdiff + ydiff * ydiff;
    var lenSqr = radius1 * radius1 + radius2 * radius2;

    return distSqr <= lenSqr;
}

function calcAngle(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x)
}

function chooseRandom(low, high) {
    return Math.floor(Math.random() * (high - low) + low);
}

function tick() {
    var now = Date.now();

    for(var i = 0; i < bullets.length; i++) {
        if(bullets[i].x < BULLET_RADIUS || bullets[i].x > ARENA_WIDTH - BULLET_RADIUS || bullets[i].y < BULLET_RADIUS || bullets[i].y > ARENA_HEIGHT - BULLET_RADIUS) {
            bullets.splice(i--, 1);
            continue;
        }

        var speed = 12;
        bullets[i].x += speed * Math.cos(bullets[i].angle);
        bullets[i].y += speed * Math.sin(bullets[i].angle);
    }

    for(var id = 0; id < players.length; id++) {
        if(!players[id])
            continue;

        players[id].respawned = undefined;

        players[id].changes = {};
        if(players[id].sendPos) {
            players[id].changes.x = players[id].x;
            players[id].changes.y = players[id].y;
            players[id].sendPos = false;
        }

        if(players[id].x < PLAYER_RADIUS) {
            players[id].changes.x = players[id].x = PLAYER_RADIUS;
        }
        if(players[id].x > ARENA_WIDTH - PLAYER_RADIUS) {
            players[id].changes.x = players[id].x = ARENA_WIDTH - PLAYER_RADIUS;
        }
        if(players[id].y < PLAYER_RADIUS) {
            players[id].changes.y = players[id].y = PLAYER_RADIUS;
        }
        if(players[id].y > ARENA_HEIGHT - PLAYER_RADIUS) {
            players[id].changes.y = players[id].y = ARENA_HEIGHT - PLAYER_RADIUS;
        }

        for(var i = 0; i < bullets.length; i++) {
            if(players[id].bulletsShot.indexOf(bullets[i].id) == -1 && intersects(players[id], PLAYER_RADIUS, bullets[i], BULLET_RADIUS)) {
                players[id].health -= 10;

                if(players[id].health <= 0) {
                    generatePlayer(id);
                    players[id].changes.x = players[id].x;
                    players[id].changes.y = players[id].y;
                    players[id].respawned = true;
                    players[bullets[i].playerId].score++;
                }

                if(players[bullets[i].playerId]) {
                    var idx = players[bullets[i].playerId].bulletsShot.indexOf(bullets[i].id);
                    if(idx == -1) {
                        console.log('could not find bullet?');
                    } else {
                        players[bullets[i].playerId].bulletsShot.splice(idx, 1);
                    }
                }
                bullets.splice(i, 1);
                i--;
            }
        }

        if(players[id].powerup && (Date.now() - players[id].powerup.timeEquipped >= players[id].powerup.activeTime)) {
            players[id].changes.powerup = players[id].powerup = null;
        }

        for(var i = 0; i < powerups.length; i++) {
            if(intersects(players[id], PLAYER_RADIUS, powerups[i], POWERUP_RADIUS)) {
                players[id].changes.powerup = players[id].powerup = powerups.splice(i--, 1)[0];
                players[id].powerup.timeEquipped = Date.now();
            }
        }

        players[id].changes.score = players[id].score;
        players[id].changes.health = players[id].health;

        var bulletCooldown = players[id].powerup && players[id].powerup.type == POWERUP_SHOOT_FASTER ? 100 : 300;
        if(players[id].shooting && (!players[id].lastShotTime || now - players[id].lastShotTime > bulletCooldown)) {
            var offset = 25, angleOff = Math.PI / 4;
            var angle = calcAngle(players[id], players[id].aiming);
            var bulletX = players[id].x + offset * Math.cos(angle + angleOff);
            var bulletY = players[id].y + offset * Math.sin(angle + angleOff);
            
            bullets.push({
                id: totalBulletCount++,
                playerId: id,
                x: bulletX,
                y: bulletY,
                angle: players[id].angle,
            });

            players[id].bulletsShot.push(totalBulletCount - 1);
            players[id].lastShotTime = now;
        }
    }

    if(powerups.length < 5 && now - lastPowerupSpawnTime >= currentCooldownTime) {
        powerups.push({
            x: chooseRandom(POWERUP_RADIUS, ARENA_WIDTH - POWERUP_RADIUS),
            y: chooseRandom(POWERUP_RADIUS, ARENA_HEIGHT - POWERUP_RADIUS),
            type: POWERUP_SHOOT_FASTER,
            activeTime: POWERUP_SHOOT_FASTER_TIME
        });

        lastPowerupSpawnTime = now;
        currentCooldownTime = chooseRandom(POWERUP_COOLDOWN_MIN, POWERUP_COOLDOWN_MAX);
    }

    for(var id = 0; id < players.length; id++) {
        if(!players[id])
            continue;

        var others = [];
        players.forEach(function(curr, idx) {
            if(idx != id && curr) {
                others.push({
                    id: idx,
                    name: curr.name,
                    timestamp: curr.timestamp,
                    x: curr.x,
                    y: curr.y,
                    angle: curr.angle,
                    health: curr.health,
                    score: curr.score,
                    respawned: curr.respawned,
                    powerup: curr.powerup
                });
            }
        });

        try {
            players[id].conn.send(JSON.stringify({ pingMsg: players[id].pingMsg, self: players[id].changes, others: others, bullets: bullets, powerups: powerups }));
        } catch(e) {
            console.error('error: ' + e.message);
        }
    }
}
