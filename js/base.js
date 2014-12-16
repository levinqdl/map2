var projection = new BMap.MercatorProjection();
function lngLatToPoint( x, y){
	return projection.lngLatToPoint(new BMap.Point(x, y));
}
function pointToLngLat( x, y){
	return projection.pointToLngLat(new BMap.Pixel(x, y));
}
function getPoint ( x, y ){
	x = Math.floor(x/100) + ( x - Math.floor(x/100) * 100 ) / 60;
	y = Math.floor(y/100) + ( y - Math.floor(y/100) * 100 ) / 60;
	gpsPoint = new BMap.Point(x,y);
	var dtd = $.Deferred();
	BMap.Convertor.translate(gpsPoint,0,function(point){
		dtd.resolve();
	});
	return dtd.promise();
}
function Point( x, y, lngLat, gps, context, trueValue ){
	this.dtd = $.Deferred();
	if ( !context ){
		context = {};
	}
	if ( lngLat ){
		if ( gps ){
			if ( !trueValue ){
				x = Math.floor(x/100) + ( x - Math.floor(x/100) * 100 ) / 60;
				y = Math.floor(y/100) + ( y - Math.floor(y/100) * 100 ) / 60;
			}
			gpsPoint = new BMap.Point(x,y);
			context.p = this;
			BMap.Convertor.translate(gpsPoint,0,function(point){
				context.p.bmap = point;
				context.p.pixel = lngLatToPoint( point.lng, point.lat );
				context.p.dtd.resolveWith(context);
			});
		} else {
			this.bmap = new BMap.Point(x, y);//经纬坐标表示
			this.pixel = lngLatToPoint(x, y);//平面坐标表示
			this.dtd.resolve();
		}
	} else {
		this.pixel = new BMap.Pixel(x, y);
		this.bmap = pointToLngLat(x,y);
		this.dtd.resolve();
	}
}
Point.prototype.draw = function(config){
	this.marker = new BMap.Marker( this.bmap, config );
	map.addOverlay(this.marker);
}
Point.prototype.remove = function(){
	map.removeOverlay(this.marker);
}
Point.prototype.direction = function(point) {
	var x = point.pixel.x - this.pixel.x, y = point.pixel.y - this.pixel.y;
	var rad = Math.atan(x/y);
	if ( y < 0 ){
		rad += Math.PI;
	}
	console.log("atan:"+rad);
	return rad/0.017453293;
};
Point.prototype.distance = function(point) {
	var x = this.pixel.x-point.pixel.x, y = this.pixel.y-point.pixel.y;
	return Math.sqrt(x*x + y*y);
};

//线定义，传入点斜式：y-y1=k(x-x1)，转为一般式：ax+by+c=0
//x,点的横坐标，实为经度
//y,点的纵坐标，实为纬度
//k,斜率
function Line ( p, ang, config, endPoint ){
	var k;
	
	this.p = p;
	this.config = config;
	if ( endPoint ){
		this.endPoint = endPoint;
		if ( endPoint.pixel.x - p.pixel.x == 0 ){
			k = null;
		} else {
			k = ( endPoint.pixel.y - p.pixel.y ) / ( endPoint.pixel.x - p.pixel.x );
		}
	} else if ( typeof ang !== 'undefined' && ang !== null  ){
		this.ang = ang *0.017453293; //转为弧度
		if ( this.ang == 0 ){
			k == null;
		} else {
			k = slope(this.ang);
		}
		var x = this.p.pixel.x + Math.sin(this.ang);
		var y = this.p.pixel.y + Math.cos(this.ang)
		this.endPoint = new Point(x, y );
	}
	
	if ( k === null ){
		this.a = 1;
		this.b = 0;
		this.c = -p.pixel.x;
	} else if ( k === 0 ){
		this.a = 0;
		this.b = 1;
		this.c = -p.pixel.y;
	} else {
		this.a = k;
		this.b = -1;
		this.c = p.pixel.y-k*p.pixel.x;
	}
}
Line.prototype.draw = function( length ){
	//this.p.draw();
	var x = this.p.pixel.x + length * Math.sin(this.ang);
	var y = this.p.pixel.y + length * Math.cos(this.ang);
	point = new Point( x, y, false);
	this.polyline = new BMap.Polyline([    
		this.p.bmap,
		point.bmap
	],
	{strokeColor:this.config.lineColor, strokeWeight:2, strokeOpacity:0.5}    
	);
	map.addOverlay(this.polyline);
	return point;
}
Line.prototype.remove = function( ){
	map.removeOverlay( this.polyline);
}
//计算两条直线交点
Line.prototype.intersection = function( line ){
	if ( this.a * line.b == line.a * this.b ){
		return false;
	} else {
		var x = (line.b*this.c - line.c* this.b)/ ( line.a*this.b - this.a * line.b);
		var y = (this.a * line.c - this.c * line.a)/ ( line.a* this.b - this.a * line.b);
		return new Point(x, y, false);
	}
}
Line.prototype.insideClipEdge = function(point, direction){
	var A,B;
	A = this.endPoint;
	B = this.p;
	var value = (B.pixel.x - A.pixel.x )*( point.pixel.y - A.pixel.y ) - ( B.pixel.y - A.pixel.y )*( point.pixel.x - A.pixel.x);
	if ( direction == 1 ){
		value = - value;
	}
	if ( value >= 0){
		return true;
	} else if ( value < 0 ){
		return false;
	}
}

function slope( ang ){
	return 1/Math.tan ( ang );
}

function Sector ( p, ang, range, config){
	this.p = p;
	this.lines = [new Line( p, ang - range ,config), new Line( p, ang + range, config )];
	this.sidePoints = [];
}
//绘制扇形区域
Sector.prototype.draw = function(length){
	this.p.draw();
	for ( i in this.lines ){
		var point = this.lines[i].draw(length);
		this.sidePoints.push(point);
	}
	this.polygon = new Polygon();
	this.sidePoints.unshift(this.p);
	this.polygon.path = this.sidePoints;
}
Sector.prototype.remove = function(){
	this.p.remove();
	for ( i in this.lines ){
		this.lines[i].remove();
	}
}
Sector.prototype.intersection = function( sector ){
	var p, polygonPoints = [], i=[0,1,1,0], j = [0,0,1,1];
	var polygon = new Polygon();
	for ( var index = 0; index <= 3; index++ ){
		p = this.lines[i[index]].intersection( sector.lines[j[index]] );
		if ( p !== false ){
			polygon.path.push(p);
		}
	}
	return polygon;  //创建多边形
}
//http://en.wikipedia.org/wiki/Sutherland%E2%80%93Hodgman_algorithm
Sector.prototype.clip = function ( polygon ){
	var input = polygon.path, output, E,S,i;
	for ( i in this.lines ){
		S = input.length-1;
		output = [];
		for ( E in input ){
			//console.log('line:'+i);
			//console.log('E:'+E+' '+this.lines[i].insideClipEdge(input[E], i));
			//console.log(input);
			if ( this.lines[i].insideClipEdge(input[E], i) ){
				if ( this.lines[i].insideClipEdge(input[S], i ) == false ){
					output.push( this.lines[i].intersection( new Line(input[S], null, null, input[E])));
				}
				output.push( input[E] );
			} else if ( this.lines[i].insideClipEdge( input[S] , i ) ){
				output.push( this.lines[i].intersection(new Line(input[S], null, null, input[E])));
			}
			S = E;
		}
		input = output;
	}
	polygon = new Polygon();
	polygon.path = input;
	return polygon;
}

function Polygon (){
	this.path = [];
}
Polygon.prototype.draw = function(){
	var path = [], i;
	for ( i in this.path ){
		path.push( this.path[i].bmap);
		//this.path[i].draw();
	}
	this.bmap = new BMap.Polygon(path, {strokeColor:"blue", strokeWeight:2, strokeOpacity:0.5, fillColor:'yellow'});
	map.addOverlay(this.bmap);
}
Polygon.prototype.remove = function(){
	map.removeOverlay( this.bmap );
}

function InfoControl(id){
    this.defaultAnchor = BMAP_ANCHOR_TOP_RIGHT;    
    this.defaultOffset = new BMap.Size(10, 10);
	this.id = id;
}    
InfoControl.prototype = new BMap.Control();
InfoControl.prototype.initialize = function(map){    
	var div = document.createElement("div");
	
	div.id = this.id;
	div.style.border = "1px solid gray";
	div.style.backgroundColor = "black";
 // 添加DOM元素到地图中   
 map.getContainer().appendChild(div);    
 // 将DOM元素返回
 return div;
 }
 InfoControl.prototype.hide = function( direction ){
	var offset = 0;
	var div = $('#'+this.id);
	var transition = 0;
	div.addClass('infoControl');
	if ( direction == 'right' ){
		div.addClass('landscape');
		offset = $(window).width();
		direction = 'left';
		transition = div.width();
	} else if ( direction == 'bottom' ){
		div.addClass('portait');
		offset = $(window).height();
		direction = 'top';
		transition = div.height();
	}
	var style = {};
	style[direction] = offset - 30;
	div.offset(style);
	var ani_style = {};
	ani_style[direction] = offset - transition;
	div.hover(function(){
		div.animate(ani_style);
	},function(){
		div.animate(style);
	})
 }
 InfoControl.prototype.setInfo = function ( info ){
	this.info = info;
 }
 InfoControl.prototype.update = function (tpl){
	for ( i in this.info ){
		tpl = tpl.replace('{'+i.toUpperCase()+'}', this.info[i]);
	}
	$('#'+this.id).empty();
	$('#'+this.id).append(tpl);
 }