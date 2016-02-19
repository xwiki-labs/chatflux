;(function () { 'use strict';
let Crypto = require('crypto');
let WebSocket = require('ws');

let dropUser;

let sendMsg = function (ctx, user, msg) {
    try {
        console.log('<' + JSON.stringify(msg));
        user.socket.send(JSON.stringify(msg));
    } catch (e) {
        console.log(e.stack);
        dropUser(ctx, user);
    }
};

let sendChannelMessage = function (ctx, channel, msgStruct) {
    msgStruct.unshift(0);
    channel.forEach(function (user) { sendMsg(ctx, user, msgStruct); });
};

dropUser = function (ctx, user) {
    if (user.socket.readyState !== WebSocket.CLOSING
        && user.socket.readyState !== WebSocket.CLOSED)
    {
        try {
            user.socket.close();
        } catch (e) {
            console.log("Failed to disconnect ["+user.userName+"], attempting to terminate");
            try {
                user.socket.terminate();
            } catch (ee) {
                console.log("Failed to terminate ["+user.userName+"]  *shrug*");
            }
        }
    }
    delete ctx.users[user.id];
    Object.keys(ctx.channels).forEach(function (chanName) {
        let chan = ctx.channels[chanName];
        let idx = chan.indexOf(user);
        if (idx < 0) { return; }
        console.log("Removing ["+user.userName+"] from channel ["+chanName+"]");
        chan.splice(idx, 1);
        if (chan.length === 0) {
            console.log("Removing empty channel ["+chanName+"]");
            delete ctx.channels[chanName];
        } else {
            sendChannelMessage(ctx, chan, [user.id, 'LEAVE', chanName, 'Quit: [ dropUser() ]']);
        }
    });
};

let randName = function () { return Crypto.randomBytes(16).toString('hex'); };

let handleMessage = function (ctx, user, msg) {
    console.log(msg);
    let json = JSON.parse(msg);
    let seq = json.shift();
    let cmd = json.shift();
    let obj = json.shift();

    if (cmd === 'JOIN') {
        if (obj && !ctx.channels[obj]) {
            sendMsg(ctx, user, [seq, 'ERROR', 'ENOENT', obj]);
            return;
        }
        let chanName = obj || randName();
        let chan = ctx.channels[chanName] = ctx.channels[chanName] || [];
        chan.forEach(function (u) { sendMsg(ctx, user, [0, u.ud, 'JOIN', chanName]); });
        chan.push(user);
        sendChannelMessage(ctx, chan, [user.id, 'JOIN', chanName]);
        return;
    }
    if (cmd === 'MSG') {
        if (obj && !ctx.channels[obj] && !ctx.users[obj]) {
            sendMsg(ctx, user, [seq, 'ERROR', 'ENOENT', obj]);
            return;
        }
        let target;
        json.unshift(user.id);
        if ((target = ctx.channels[obj])) {
            sendChannelMessage(ctx, target, json);
            return;
        }
        if ((target = ctx.users[obj])) {
            json.unshift(0);
            sendMsg(ctx, target, json);
            return;
        }
    }
    if (cmd === 'LEAVE') {
        let err;
        let chan;
        let idx;
        if (!obj) { err = 'EINVAL'; }
        if (!err && !(chan = ctx.channels[obj])) { err = 'ENOENT'; }
        if (!err && (idx = chan.indexOf(user)) === -1) { err = 'NOT_IN_CHAN'; }
        if (err) {
            sendMsg(ctx, user, [seq, 'ERROR', err]);
            return;
        }
        json.unshift(user.id);
        sendChannelMessage(ctx, chan, [user.id, 'LEAVE', chan.id]);
        chan.splice(idx, 1);
    }
    if (cmd === 'PING') {
        sendMsg(ctx, user, [seq, 'PONG', obj]);
        return;
    }
};

let run = module.exports.run = function (socketServer) {
    let ctx = {
        users: {},
        channels: {}
    };
    socketServer.on('connection', function(socket) {
        let conn = socket.upgradeReq.connection;
        let user = {
            addr: conn.remoteAddress + '|' + conn.remotePort,
            socket: socket,
            id: randName()
        };
        ctx.users[user.id] = user;
        sendMsg(ctx, user, [0, 'IDENT', user.id]);
        socket.on('message', function(message) {
            console.log('>'+message);
            try {
                handleMessage(ctx, user, message);
            } catch (e) {
                console.log(e.stack);
                dropUser(ctx, user);
            }
        });
        socket.on('close', function (evt) {
            for (let userId in ctx.users) {
                if (ctx.users[userId].socket === socket) {
                    dropUser(ctx, ctx.users[userId]);
                }
            }
        });
    });
};
}());
