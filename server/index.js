const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const server = require('http').createServer(app);

port = process.env.PORT || 8080 ;

app.use(cors());
require('./services/socketio')(server);

app.use(express.static(path.join(__dirname, '../client/build')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
});

server.listen(port, ()=> console.log(`server listen on ${port}`));