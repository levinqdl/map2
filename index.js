var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var querystring = require("querystring");
var async = require("async");

/****mysql connection****/
var mysql = require('mysql');
var mysqlConf = require('./db/config.js');
var conn = mysql.createConnection(mysqlConf);
conn.connect(function(err){
	//connected!(unless 'err' is set)
	if ( err ){
		console.log(err);
	}
});


var qm = new QueueManager();
var looper = new Looper();


app.get('/', function(req, res){
  res.sendFile(__dirname+'/index.html');
});
app.get('/base.js', function(req, res){
  res.sendFile(__dirname+'/js/base.js');
});
app.get('/jquery.js', function(req, res){
  res.sendFile(__dirname+'/js/jquery-1.11.1.min.js');
});
app.get('/history', function(req, res){
  res.sendFile(__dirname+'/history.html');
});

app.post('/call', function( req, res ){
	var postData = ""; 
	req.addListener("data", function (postDataChunk) {
        postData += postDataChunk;
    });
    // 数据接收完毕，执行回调函数
    req.addListener("end", function () {
		//parse post data
        var params = querystring.parse(postData);
        console.log(params);
        console.log(params["data"]);
		
		//parse json data
		if ( params["json"] ){
			var data = JSON.parse( params["json"] );
			if ( data.n != 3 ){
				qm.getQueueById(data.n).enqueue(params['json']); // dispatch and enqueue
				
				for ( var key in data ){
					console.log( key+":"+data[key] );
				}
				console.log('data received');
			} else {
				io.emit('target', params['json']);
			}
		}
		
		// qm.getQueueById(data.N).enqueue( data.value );
        res.writeHead(500, {
            "Content-Type": "text/plain;charset=utf-8"
        });
        res.end("call success\n");
        
    });
});

app.post('/car', function( req, res ){
	var n = req.query.n;
	var postData = ""; 
	req.addListener("data", function (postDataChunk) {
        postData += postDataChunk;
    });
    // 数据接收完毕，执行回调函数
    req.addListener("end", function () {
		//parse post data
        var params = querystring.parse(postData);
		
		//parse json data
		if ( params["json"] ){
			console.log('info '+n+' received');
			var json = params["json"];
			io.emit('info', {n:n, json:json});
			//clear lost connection timer
			if ( qm.timer[n] ){
				clearTimeout(qm.timer[n]);
			}
			console.log('setTimeout,'+n);
			qm.timer[n] = setTimeout(notifyLost, 15000, n);
		}
		
        res.writeHead(500, {
            "Content-Type": "text/plain;charset=utf-8"
        });
        res.end("car success\n");
        
    });
});


var lastStrPoly = null;
io.on('connection', function(socket){
  console.log('a user connected');
  socket.on('chat message', function(msg){
    console.log('message: ' + msg);
  });
  socket.on('store', function(msg){
console.log("*****************************store*******************");	
console.log(msg);
  var strPoly = JSON.stringify(msg.polygon);
  var target = JSON.stringify(msg.target);
  if ( strPoly != lastStrPoly ){
	conn.query('INSERT INTO data ( time, polygon, target ) VALUES('+msg.time+',\''+strPoly+'\',\''+target+'\')', function(err, rows, fields) {
		console.log('store:'+rows+'rows');
		console.log(err);
	})
	lastStrPoly = strPoly;
  }
  });
  socket.on('history', function(msg){
	
	conn.query('SELECT * FROM data ORDER BY id DESC limit 44 ', function( err, rows, fields ){
		if ( err ){
			console.log(err);
			io.emit('history_return', 'error');
		} else {
			io.emit('history_return', rows);
		}
	});
	//delete old records
	conn.query('SELECT id FROM data ORDER BY id DESC limit 50, 1', function( err, rows, fields ){
		console.log(rows);
		if ( rows.length ){
			conn.query('DELETE FROM data WHERE id <= '+rows[0].id, function( err, rows, fields){
				console.log( rows );
			});
		}
	});
  })
});

http.listen(3001, function(){
  console.log('listening on *:3001');
});

//Queue
function Queue(size){
	this.size = size;
	this.head = 0;
	this.queue = new Array(this.size);
	this.tail = 0;
}
Queue.prototype.enqueue = function(obj){
	var tail = (this.tail+1)%this.size;
	if ( tail == this.head ){
		return false;
	} else {
		this.queue[this.tail] = obj;
		this.tail = tail;
	}
}
Queue.prototype.dequeue = function(){
	var tmp;
	if ( this.tail == this.head ){
		return false;
	} else {
		tmp = this.queue[this.head];
		this.head = (this.head+1)%this.size;
	}
	return tmp;
}
Queue.prototype.isEmpty = function(){
	if ( this.tail == this.head ){
		return true;
	}
	return false;
}
Queue.prototype.getHead = function(){
	return this.queue[this.head];
}

//Queue Manager
function QueueManager(){
	this.queueTable = {};
	this.timer = new Array(3);
}
QueueManager.prototype.getQueueById = function(id){
	if ( typeof this.queueTable[id] == 'undefined' ){
		this.queueTable[id] = new Queue( 50 );
	}
	return this.queueTable[id];
}

function Looper ( ){
	this.flag = false;
}
Looper.prototype.fetch = function(cb){
	var table = qm.queueTable, keeper=[], result=[];
	for(var key in table ){
		var queue = table[key];
		if ( queue.isEmpty() == false ){
			var head = queue.getHead();
			
			var time = JSON.parse(head).time;
			time = new Date().setHours(time.substr(0,2),time.substr(2,2),time.substr(4,2));
			time = time / 1000;
			keeper.push({key:key,time:time});
		}
	}
	if ( keeper.length ){
	
	broadcast(keeper);
	}
	console.log('keeper length:'+keeper.length);
	/*
	if ( keeper.length == 3 ){
		keeper.sort( function( a, b){
			return a.time - b.time;
		});
		var end = keeper.length-1;
		while ( end > 0 ){
			console.log(keeper);
			if ( keeper[end].time - keeper[0].time <= range ){
				broadcast(keeper);
				break;
			} else {
				end--;
			}
			if ( end == 0 ){
				console.log('en');
				qm.queueTable[keeper[0].key].dequeue();
			}
		}
	}
	*/
	setTimeout(cb, 200);
}
function broadcast( arr ){
	console.log('***************************result call****************');
	var r = [];
	for ( var i=0; i < arr.length; i++ ){
		var queue = qm.queueTable[arr[i].key];
		r.push(queue.dequeue());
	}
	io.emit('update', r);
}

function notifyLost(n){
	console.log('notifyLost,'+n);
	io.emit('car_lost', n);
}

async.forever( looper.fetch, function( err ){
	console.log(err);
});
