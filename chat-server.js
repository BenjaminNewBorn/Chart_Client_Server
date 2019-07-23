// Require the packages we will use:
var http = require("http"),
    socketio = require("socket.io"),
    fs = require("fs");
    express = require("express");
var mysql=require('mysql');
var sql_connect=mysql.createConnection({
    host:'localhost',
    user:'wustl_inst',
    password:'wustl_pass',
    database : 'chat'
});
sql_connect.connect();
var memberMap = new Map();
var banMap = new Map();
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function(req, resp){
    // This callback runs when a new connection is made to our HTTP server.

    fs.readFile("client.html", function(err, data){
        // This callback runs when the client.html file has been read from the filesystem.

        if(err) return resp.writeHead(500);
        resp.writeHead(200);
        resp.end(data);
    });
});
app.listen(3456);

// Do the Socket.IO magic:
var io = socketio.listen(app);
io.sockets.on("connection", function(socket){

    socket.on('message_to_server', function(data) {
        var msg = data["nickname"] + ": " + data["message"];
        console.log(msg);
        io.sockets.emit("message_to_client",{message:msg, members:memberMap.get(data["room_id"]),pm_user:""})
    });

    socket.on('send_per_user', function(data) {
        room_id = data["room_id"];
        var memberarray = memberMap.get(room_id);
        hasPerson = false;
        var pm_user = data["pm_user"];
        memberarray.forEach(function(item) {
            if(pm_user === item) {
                hasPerson = true;
            }
        });
        if(hasPerson) {
            var res = "You send to " + pm_user + " : " + data["pm_content"];
            socket.emit("pr_sender",{check:true, message: res});
            var msg = data["sender"] + "send to you personally: " + data["pm_content"];
            console.log(msg);
            io.sockets.emit("message_to_client",{message:msg, members:memberMap.get(data["room_id"]),pm_user:data["pm_user"]});
        } else {
            socket.emit("pr_sender",{check:false, message: "the user are not in this chat room currently"});
        }




    });

    socket.on('message_register', function(data) {
        // This callback runs when the server receives a new message from the client.

        var sql_query = "INSERT INTO user VALUES (?,?,?)";
        var sql_params = [data["username"], data["password"], data["nickname"]];
        sql_connect.query(sql_query,sql_params,function(err,result) {
            if(err) {
                socket.emit("register_msg",{check:false, message:"register failed"})
            }
            console.log(result);
            var check = result.affectedRows;
            console.log(check);
            if(check === 1) {
                socket.emit("register_msg", {check:true, username:data["username"], nickname:data["nickname"], message:"register successfully"});
            } else {
                socket.emit("register_msg",{check:false,message:result["message"]});
            }

        });
        console.log("username: "+data["username"]); // log it to the Node.JS output
    });

    socket.on('message_login', function(data) {
        // This callback runs when the server receives a new message from the client.

        var sql_query = "SELECT count(*) as count, password, nickname FROM user where username = ?";
        sql_connect.query(sql_query,data["username"],function(err,result) {
            if(err) {
                socket.emit("login_msg",{check:false, message:"register failed"})
            }
            console.log(result);
            var con = result[0].count;
            var nickname = result[0]["nickname"];

            if(con === 1) {
                var realPassword = result[0]["password"];
                if (realPassword === data["password"]){
                    socket.emit("login_msg", {check:true, username:data["username"],nickname:nickname, message:"login successfully"});
                    console.log(con,nickname);
                } else{
                    socket.emit("login_msg",{check:false,message:"Wrong password"});
                }
            } else {
                socket.emit("login_msg",{check:false,message:"No such user"});
            }
        });
    });

    socket.on('create_room', function(data) {
        var sql_query="INSERT INTO rooms(roomname,password,owner,private) VALUES (?,?,?,?)";
        var sql_params=[data["roomname"],data["roomPassword"],data["nickname"],data["privateRoom"]];
        sql_connect.query(sql_query,sql_params,function (err,result) {
            if(err){
                socket.emit("create_room_msg",{check:false,message:"Create room failed"});
                console.log(sql_query);
                console.log(sql_params);
                return;
            }
            console.log(result);
            var check=result.affectedRows;
            console.log(check);
            if (check===1){
                var memberarray = [];
                memberMap.set(result.insertId ,memberarray );
                io.sockets.emit("create_room_msg",{check:true,message:"Create Room Success",room_id:result.insertId });
            }else{
                socket.emit("create_room_msg",{check:false,message:result["message"]});
            }
        });
    });

    socket.on('show_rooms', function(data) {
        var sql_query="SELECT id, roomname, owner, private FROM rooms";
        sql_connect.query(sql_query,function (err,result) {
            if(err){
                socket.emit("create_room_msg",{check:false,message:"show rooms failed"});
                console.log(sql_query);
                console.log(sql_params);
                return;
            }
            console.log(result);
            for(var i = 0; i < result.length; i++) {
                var room_id = result[i]["id"];
                var room_name = result[i]["roomname"];
                var owner = result[i]["owner"];
                var private_room = result[i]["private"];
                if(private_room === 1) {
                    socket.emit("show_room_msg", {room_id: room_id, room_name:room_name,owner:owner,private_room:true});
                } else {
                    socket.emit("show_room_msg", {room_id: room_id, room_name:room_name,owner:owner,private_room:false});
                }
            }
        });
    });

    socket.on('delete_room', function(data) {
        var sql_query="DELETE FROM rooms where id=?";
        sql_connect.query(sql_query,data["room_id"],function (err,result) {
            if(err){
                socket.emit("delete_room_msg",{check:false,message:"delete room failed"});
                console.log(sql_query);
                return;
            }
            memberMap.delete(data["room_id"]);
            console.log(result);
            io.sockets.emit("delete_room_msg",{check:true,message:"Delete Room Success"});
        });
    });

    socket.on('join_room', function(data) {
        var room_id = data["room_id"];
        var banArray = banMap.get(room_id);
        var banned = false;
        if (typeof(banArray) != "undefined" ) {
            banArray.forEach(function(item) {
                if(item === data["nickname"]) {
                    socket.emit("join_room_msg",{check:false,message:"You are banned from this chat Room"});
                    banned = true;
                }
            })
        }
        if(!banned) {
            var sql_query="select count(*) as count,roomname, owner,password from rooms where id=?";
            sql_connect.query(sql_query,data["room_id"],function (err,result) {
                if(err){
                    console.log('insert error'+sql_query+sql_params);
                    return;
                }
                var check=result[0].count;
                if(check === 1) {
                    if(data["private_room"] && result[0]["password"] !== data["password"]) {
                        socket.emit("join_room_msg",{check:false,message:"Join Room failed, please check the password"});
                    } else {
                        var room_id = data["room_id"];
                        var memberarray = memberMap.get(room_id);
                        if (typeof(memberarray) != "undefined"){
                            memberarray.push(data["nickname"]);
                        } else {
                            memberarray = [];
                            memberarray.push(data["nickname"]);
                        }
                        memberMap.set(room_id,memberarray );
                        console.log(data["nickname"] + " join room " + room_id);
                        socket.emit("join_room_msg",{check:true,message:"Join Room Success",room_id:room_id,room_name:result[0]["roomname"], owner:result[0]["owner"]});
                        io.sockets.emit("new_join_msg", {room_id:room_id,members:memberarray,owner:result[0]["owner"]})
                    }
                } else {
                    console.log('did not tuple');
                    socket.emit("join_room_msg",{check:false,message:"Join Room failed, please check the password"});
                }
            });
        }
    });

    socket.on('left_room', function(data) {
        var room_id = data["room_id"];
        var memberarray = memberMap.get(room_id);
        memberarray.forEach(function(item, index) {
            if(data["nickname"] === item) {
                memberarray.splice(index, 1);
            }
        });
        memberMap.set(room_id, memberarray);
        console.log(data["nickname"] + " left room " + data["room_id"]);
        socket.emit("left_room_msg",{check:true,message:"Left Room Success",room_id:room_id});
        io.sockets.emit("new_left_msg", {room_id:room_id,members:memberarray,owner:data["owner"]})
    });

    socket.on('kick_user', function(data) {
        var room_id = data["room_id"];
        var memberarray = memberMap.get(room_id);
        memberarray.forEach(function(item, index) {
            if(data["kickuser"] === item) {
                memberarray.splice(index, 1);
            }
        });
        memberMap.set(room_id, memberarray);
        console.log(data["kickuser"] + " is kicked from " + data["room_id"]);
        io.sockets.emit("kick_user_msg", {room_id:room_id,members:memberarray,kick_user:data["kickuser"], owner:data["owner"]})
    });

    socket.on('ban_user', function(data) {
        var room_id = data["room_id"];
        var banArray = banMap.get(room_id);
        var newUser = true;
        if (typeof(banArray) != "undefined"){
            banArray.forEach(function (item){
                if (item === data["banned_per"]) {
                    newUser = false;
                }
            });
            if(newUser){
                banArray.push(data["banned_per"]);
            }
        } else {
            banArray = [];
            banArray.push(data["banned_per"]);
        }
        banMap.set(room_id,banArray );

        var msg = "you have banned user " + data["banned_per"];
        console.log(data["banned_per"] + " is banned from " + data["room_id"]);
        socket.emit("ban_res_msg",{message:msg});
    });

    socket.on('invite_user', function(data) {
        var room_id = data["room_id"];
        var msg = "you have invited user " + data["invite_per"] + ". If this user donot answer,it is possible that the user is in other chatroom or does not log in";
        console.log(data["invite_per"] + " is invited to " + data["room_id"]);
        socket.emit("invite_res",{message:msg});

        var invitation = data["owner"] + " invited you to his room (id: " + data["room_id"] + ")";
        io.sockets.emit("invite_user_msg", {message:invitation, room_id:room_id, invite_per:data["invite_per"]});
    });




});

