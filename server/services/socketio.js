const {Server} = require('socket.io');
const { handleCommand, resetGame } = require('./gameEngine');

const socketServer = (server) => {

    let rooms = {}
    let users = {}
 
    const io = new Server(server,{
        cors:{
            origin: '*',
            methods:['GET',"POST"]
        }
    });

    io.on('connection', (socket)=>{

        socket.on('join',(user)=>{
            const room = user.room;
            socket.join(room);
            users[socket.id] = {...user};
            delete user.room;       
            rooms[room] = !rooms[room]? 
                        {[socket.id]:user}:
                        {...rooms[room], [socket.id]:user};
            
            const roomUsers = rooms[room];            
            for(let user in roomUsers){
                io.to(user).emit('users',roomUsers);
            }
        });

        socket.on('message', ({data, aesKey})=>{
            // ── Game Engine Intercept ──────────────────────
            // Game commands are sent as normal encrypted messages.
            // We need to figure out the plaintext to check for
            // commands. Since the server does NOT have private keys,
            // we use a lightweight approach: the client will also
            // emit a 'game-command' event for messages starting
            // with '/'. But as a simpler alternative that keeps
            // everything in one event, we check a 'plaintext'
            // field that the client attaches when the message
            // starts with '/'.
            //
            // However, to stay fully compatible with the existing
            // encrypted flow, we use a separate 'game-command'
            // event (see below). The normal encrypted message
            // flow is untouched here.
            for(let userId in aesKey) io.to(userId).emit('message',{data, 'aesKey':aesKey[userId]})
        });

        // ── Game Command Event ────────────────────────────
        // The React client emits this event with the raw plaintext
        // when the user types a message starting with '/'.
        // This keeps the encrypted message flow completely intact.
        socket.on('game-command', ({ text }) => {
            const room = users[socket.id]?.room;
            if (!room) return;
            handleCommand(io, room, text);
        });

        socket.on('disconnect',()=>{
            const room = users[socket.id]?.room;
            delete users[socket.id];
            delete rooms[room]?.[socket.id];
            const roomUsers = rooms[room];            
            for(let user in roomUsers){
                io.to(user).emit('users',roomUsers);
            }
        }) 

        socket.on('logout',()=>{
            socket.disconnect();
        }) 
        
    });
}

module.exports = socketServer