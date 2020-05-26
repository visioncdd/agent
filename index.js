var moment = require('moment')
moment.locale('es');


var _ = require('lodash')

var express = require('express')
var app = require('express')();
var cors = require('cors')
var http = require('http').Server(app);
var bodyParser = require('body-parser');
var multer = require('multer');
var mkdirp = require('mkdirp');
const MongoClient = require('mongodb').MongoClient;
const ObjectId = require('mongodb').ObjectId;

var env = require('./env')

http.timeout = 120000 * 5;
http.keepAliveTimeout = 60000 * 2;

const client = new MongoClient(env.mongodbUrl);

// Use connect method to connect to the Server
client.connect(function(err) {

	console.log(err)

  console.log("Connected successfully to server");

  const db1 = client.db(env.db);

  db1.collection('productos').createIndex({name: "text"})
  // db1.collection('productos').createIndex({preffix: "text"})
  db1.collection('acciones').createIndex({term: "text"})
  db1.collection('cantidades').createIndex({numero: "text",letra: "text"})


	app.use(bodyParser.json()); 
	app.use(bodyParser.urlencoded({ extended: true }));
	app.use(cors())

	var cuentas = 'Banesco 0134'

	function searchProduct(text){
		return new Promise(resolve => {

			db1.collection('productos')
			.aggregate([{
				$match: {
					$text: {
						$search: text
					},
					quantity: {
						$gt: 0
					}
				}
			},{
				$sort: {
					score: {
						$meta: "textScore"
					}
				}
			},{
				$project: {
					name: 1,
					price: 1,
					quantity: 1,
					currency: 1,
					real_name: 1,
					description: 1,
					_id: 1,
					score: {
						$meta: "textScore"
					}
				}
			}], function(err, data){
				
				data.toArray(function(err,list){
					
					var result = []

					if(list.length){
						result.push(list[0])
						var score = list[0].score

						list.filter((v,k) => k > 0).forEach(v => {
							if(v.score == score)
								result.push(v)
						})
					}

					resolve(result)
				})
			})

		})
	}

	function getAction(text){
		return new Promise(resolve => {

			db1.collection('acciones')
			.aggregate([{
				$match: {
					$text: {
						$search: text
					}
				}
			},{
				$sort: {
					score: {
						$meta: "textScore"
					}
				}
			},{
				$project: {
					action: 1,
					term: 1,
					_id: 1,
					score: {
						$meta: "textScore"
					}
				}
			}], function(err, data){
				
				data.limit(1).toArray(function(err,list){
					console.log(list)
					resolve(list.length && list[0].score >= 0.80 ? list[0].action : null)
				})
			})

		})
	}

	function getQuantity(text){
		return new Promise(resolve => {

			db1.collection('cantidades')
			.aggregate([{
				$match: {
					$text: {
						$search: text
					}
				}
			},{
				$sort: {
					score: {
						$meta: "textScore"
					}
				}
			}], function(err, data){
				
				data.limit(1).toArray(function(err,list){
					resolve(list.length ? list[0].cantidad : null)
				})
			})

		})
	}

	function chatActive(sender){
		return new Promise(resolve => {

			db1.collection('mensajes').findOne({
				sender
			}, {
				sort: {
					createdAt: -1
				}
			}, (err, message) => {
				if(!message)
					return resolve(false)
				var date = moment(message.createdAt)
				var now = moment()
				var diff = now.diff(date, 'hour')
				resolve(diff < 1)
			})

		})
	}

	function all_items(){
		return new Promise(resolve => {

			db1.collection('productos').find({
				quantity: {
					$gt: 0
				}
			}, {
				sort: {
					createdAt: -1
				}
			}, (err, productos) => {
				resolve(productos.toArray())
			})

		})
	}

	function lastRequest(sender){
		return new Promise(resolve => {

			db1.collection('solicitudes').findOne({
				sender,
				procesado: {
					$exists: false
				}
			}, {
				sort: {
					createdAt: -1
				}
			}, (err, data) => {
				if(!data)
					return resolve({productos: [], consultas: [], sender})
				var date = moment(data.createdAt)
				var now = moment()
				var diff = now.diff(date, 'hours')
				resolve(diff < 1 ? data : {productos: [], consultas: [], sender})
			})

		})
	}

	function getProduct(_id){
		return new Promise(resolve => {

			db1.collection('productos').findOne({
				_id,
			}, {
				sort: {
					createdAt: -1
				}
			}, (err, data) => {
				resolve({
					...data,
					score: 1
				})
			})

		})
	}

	function getCompany(_id){
		return new Promise(resolve => {

			db1.collection('empresas').find({
				// _id,
			}, {}, (err, data) => {
				data.toArray().then(res => console.log(res))
				resolve(null)
			})

		})
	}

	function saveMessage(message){
		return new Promise(resolve => {

			db1.collection('mensajes').insertOne({
				...message,
				createdAt: moment().format('YYYY-MM-DD HH:mm:ss'),
				updatedAt: moment().format('YYYY-MM-DD HH:mm:ss')
			}, {}, (err, doc) => resolve(doc))

		})
	}

	function saveRequest(request){
		return new Promise(resolve => {

			var data = {
				...request,
				createdAt: request.createdAt || moment().format('YYYY-MM-DD HH:mm:ss'),
				updatedAt: moment().format('YYYY-MM-DD HH:mm:ss')
			}

			if(request._id)
				db1.collection('solicitudes').update({ _id: request._id }, data, { upsert: true }, (err, doc) => resolve(doc))
			else
				db1.collection('solicitudes').insert(data, (err, doc) => resolve(doc))

		})
	}

	function setRequestProduct(solicitud, data, cantidad){
		if(!solicitud.productos.find(v => String(v._id) == String(data[0]._id)))
			return [...solicitud.productos, {
				...data[0],
				cantidad
			}]
		else
			return solicitud.productos.map(v => {
				if(String(v._id) == String(data[0]._id))
					return {
						...v,
						cantidad
					}
				else
					return v
			})
	}

	function finalMessage(solicitud, type){
		var message = ""

		if(['delivery_pedido','pedido','delivery'].indexOf(type) !== -1){

			if(!solicitud.productos.length)
				message = " ¿Quieres realizar algún pedido?"
			else{
				message = " ¿Quieres algo más?"
			}
			
			solicitud.last_state = 'question_more'	

		}

		return message
	}

	function nextStep(solicitud){
		var message = ""
		solicitud.no_more = true

		for(var i in solicitud.productos){
			if(!solicitud.productos[i].cantidad){
				solicitud.last_product = solicitud.productos[i]._id
				solicitud.last_state = "waiting_quantity"
				message = "Por favor me indicas ¿Qué cantidad de " + solicitud.productos[i].real_name + " vas a querer?"
				return message
			}
		}

		if(solicitud.delivery === undefined || solicitud.delivery === null){
			solicitud.last_state = "delivery_pedido"
			message = " ¿Quieres que hagamos entrega a domicilio?"
		}
		else if(!solicitud.type_payment){
			solicitud.last_state = "type_payment"
			message = " ¿Vas a pagar en efectivo o transferencia?"
		}
		else if(!solicitud.confirm_request){
			solicitud.last_state = "confirm_request"
			message = " Para confirmar el pedido:"
			var total = 0
			solicitud.productos.forEach(v => {
				total += v.cantidad * v.price
				message += `\n- ${v.cantidad} ${v.real_name} = ${v.currency}${v.cantidad * v.price}`
			})
			message += `\nEn total serían $${total}. ¿Es correcto?`
		}
		else if(solicitud.type_payment == 'transferencia' && !solicitud.id_payment){
			solicitud.last_state = "waiting_id"
			message = "Ok, nuestras cuentas son:\n" + cuentas + "\nEn cuanto hagas la transferencia, me dejas el número de operación para culminar el pedido."
		}
		else if((solicitud.type_payment == 'transferencia' && solicitud.id_payment && !solicitud.procesado) || solicitud.type_payment == "efectivo"){
			solicitud.last_state = "waiting_confirm_delivery"
			solicitud.procesado = true
			message = "Ok, gracias por contactarnos, el pedido ha sido procesado, te confirmaremos la entrega."
		}

		return message
	}

	function hasPayId(mensaje){
		var id = false

		mensaje.split(' ').forEach(v => {
			if(Number(v))
				id = Number(v)
		})

		return id
	}


	app.post('/', async function(req, res) {

		console.log(req.body,req.headers)

		if(!req.headers.empresa)
			return res.json({
				data: []
			})

		var empresa = await getCompany(req.headers.empresa)
		console.log(empresa)

		if(!empresa)
			return res.json({
				data: []
			})

		var sender = req.body.senderName
		var mensaje = req.body.senderMesage

		var data = await searchProduct(mensaje)
		var action = await getAction(mensaje)


		var message = ""

		var activa = await chatActive(sender)
		var solicitud = await lastRequest(sender)

		var cities = empresa.cities

		// if(!activa)
			// message = "Hola. "


		var cantidad = await getQuantity(mensaje)
		console.log(cantidad)
		console.log(action,data.map(v => v.name), activa)

		if((solicitud.last_action == "disponibilidad" || solicitud.last_action == "disponibilidad_multiple") && !action && mensaje.toLowerCase()[0] == "y")
			if(!data.length)
				message += "Disculpa, no tengo respuesta a eso."
			else
				action = "disponibilidad"

		// console.log(action)

		if(!data.length){

			if(action == 'lista_productos'){
				action = 'disponibilidad'
				data = await all_items()
				solicitud.consultas = [...solicitud.consultas, ...data]
			}

			else if(action == "no_more")
				if(solicitud.productos.length)
					message += nextStep(solicitud)
				else
					message += "¿Te puedo ayudar en algo mas?"

			else if(cantidad && solicitud.last_state == 'waiting_quantity' && solicitud.last_product){
				var producto = solicitud.productos.find(v => String(v._id) == String(solicitud.last_product))
				if(producto){
					action = 'pedido'
					data = [producto]
					solicitud.last_state = null
					solicitud.last_product = null
				}
			}

			else if(solicitud.last_state == 'waiting_id' && hasPayId(mensaje)){
				solicitud.id_payment = hasPayId(mensaje)
				message += nextStep(solicitud)
			}

			else if(solicitud.last_state == 'question_more' && !action && !solicitud.no_more){
				if((mensaje.toLowerCase().split('si').length > 1 || mensaje.toLowerCase().split('sí').length > 1 || mensaje.toLowerCase().split('correcto').length > 1 || mensaje.toLowerCase().split('asi es').length > 1 || mensaje.toLowerCase().split('claro').length > 1 || mensaje.toLowerCase().split('perfecto').length > 1 || mensaje.toLowerCase().split('genial').length > 1) && mensaje.split('').length < 25){
					message += "Genial, ¿Me indicas lo que necesitas?"
					solicitud.last_state = "what_need"
				}
				else if((mensaje.toLowerCase().split('no').length > 1 || mensaje.toLowerCase().split('solo eso').length > 1 || mensaje.toLowerCase().split('nada mas').length > 1) && mensaje.split('').length < 25){
					if(solicitud.productos.length){
						message += nextStep(solicitud)
						action = null
					}
					else{
						message += "Vale, gracias por contactarnos, estamos a tu orden."
						solicitud.last_state = null
					}
				}
			}

			else if(solicitud.last_state == 'delivery_pedido' && !action){
				if((mensaje.toLowerCase().split('si').length > 1 || mensaje.toLowerCase().split('sí').length > 1 || mensaje.toLowerCase().split('correcto').length > 1 || mensaje.toLowerCase().split('asi es').length > 1 || mensaje.toLowerCase().split('claro').length > 1 || mensaje.toLowerCase().split('perfecto').length > 1 || mensaje.toLowerCase().split('genial').length > 1) && mensaje.split('').length < 25){
					message += "Ok, perfecto."
					solicitud.delivery = true
					if(solicitud.no_more)
						message += nextStep(solicitud)
					else
						message += finalMessage(solicitud,'delivery_pedido')
				}
				else if(mensaje.toLowerCase().split('no').length > 1 && mensaje.split('').length < 25){
					message += "Ok."
					if(solicitud.no_more){
						solicitud.delivery = false
						message += nextStep(solicitud)
					}
					else{
						solicitud.delivery = false
						message += finalMessage(solicitud,'delivery_pedido')
					}
				}
			}

			else if(solicitud.last_state == 'type_payment' && !action){
				if(mensaje.toLowerCase().split('efectivo').length > 1){
					message += "Ok, perfecto."
					solicitud.type_payment = 'efectivo'
					message += nextStep(solicitud)
				}
				else if(mensaje.toLowerCase().split('transferencia').length > 1){
					message += "Ok, perfecto."
					solicitud.type_payment = 'transferencia'
					message += nextStep(solicitud)
				}
			}

			else if((mensaje.toLowerCase().split('ok').length > 1 || mensaje.toLowerCase().split('vale').length > 1 || mensaje.toLowerCase().split('esta bien').length > 1 || mensaje.toLowerCase().split('está bien').length > 1 || mensaje.toLowerCase().split('perfecto').length > 1 || mensaje.toLowerCase().split('genial').length > 1) && mensaje.split('').length < 25 && solicitud.last_state == "decir_precio"){
				action = "pedido"
				solicitud.last_state = "decir_precio"
				data = await getProduct(solicitud.last_product)
				data = [data]
				cantidad = solicitud.last_cantidad
			}

			else if(solicitud.last_state == 'confirm_request' && !action){
				if((mensaje.toLowerCase().split('si').length > 1 || mensaje.toLowerCase().split('sí').length > 1 || mensaje.toLowerCase().split('correcto').length > 1 || mensaje.toLowerCase().split('asi es').length > 1 || mensaje.toLowerCase().split('claro').length > 1 || mensaje.toLowerCase().split('perfecto').length > 1 || mensaje.toLowerCase().split('genial').length > 1) && mensaje.split('').length < 25){
					// message += "Ok, perfecto."
					solicitud.confirm_request = true
					message += nextStep(solicitud)
				}
				else if(mensaje.toLowerCase().split('no').length > 1 && mensaje.split('').length < 7){
					message += "Para corregir, por favor dime el producto y la cantidad de lo que quieres."
					solicitud.last_state = null
				}
			}

		}
		else{
			if((solicitud.last_state == "what_need" || solicitud.last_state == "question_more" || (cantidad && data.length == 1 && solicitud.consultas.find(v => v._id == data[0]._id))) && !action)
				action = "pedido"
			else if(cantidad && (!action || action == "pedido") && data.length == 1 && !solicitud.consultas.find(v => String(v._id) == String(data[0]._id))){
				action = null
				message += data[0].real_name + ` tiene un costo de ${data[0].currency}${data[0].price}`
				if(data[0].description)
					message += `\n${data[0].description}`
				solicitud.last_state = "decir_precio"
				solicitud.last_product = data[0]._id
				solicitud.last_cantidad = cantidad
			}
			else if(action == "no_more")
				action = "pedido"
		}

		if(!action && data.length && !message)
			action = "disponibilidad"

		if(action)
			solicitud.last_action = action

		switch(action){
			case 'disponibilidad':

				if(data.length){
					if(data.length > 1){
						message += "Tenemos disponible:"
						data.forEach(v => message += `\n- ${v.real_name} en ${v.currency}${v.price}` + (v.description ? `\n${v.description}\n` : ''))
						solicitud.last_state = "disponibilidad_multiple"
					}
					else if(data.length == 1){
						if(data[0].score < 1)
							message += `Puedes ser un poco más específico(a)?`
						else{
							message += `Si disponemos de ${data[0].real_name}, en ${data[0].currency}${data[0].price}`
							if(data[0].description)
								message += `\n${data[0].description}`
							solicitud.last_state = 'disponibilidad_singular'
							solicitud.last_product = data[0]._id
						}
					}
				}
				else
					message += "No, no disponemos"

				solicitud.consultas = [...solicitud.consultas, ...data]

			break;

			case 'delivery':

				message += "Si, si hacemos entrega a domicilio en toda " + cities + ". ¿Lo quieres?"
				solicitud.last_state = 'delivery_pedido'
				
				// message += finalMessage(solicitud,'delivery')

			break;

			case 'delivery_pedido':

				message += "Ok, perfecto."
				solicitud.delivery = true

				message += finalMessage(solicitud,'delivery_pedido')

			break;

			case 'informacion':

				if(!data.length && solicitud.last_state == 'disponibilidad_multiple')
					message += "Lo siento, lo que pides no disponemos."

			break;

			case 'question_type_payment':

				// if(!data.length && solicitud.last_state == 'disponibilidad_multiple')
					message += "En efectivo o transferencia"

			break;

			case 'banks':

				// if(!data.length && solicitud.last_state == 'disponibilidad_multiple')
					message += "Por ahora solo Banesco"

			break;

			case 'question_major':

				// if(!data.length && solicitud.last_state == 'disponibilidad_multiple')
					message += "Por el momento no vendemos al mayor."

			break;

			case 'delivery_city':

				// if(!data.length && solicitud.last_state == 'disponibilidad_multiple')
					message += "Hacemos envíos en toda " + cities

			break;

			case 'buenas':

				// if(!data.length && solicitud.last_state == 'disponibilidad_multiple')
					message += "Buenas..."

			break;

			case 'pedido':

				if(!data.length){
					if(solicitud.last_state == 'delivery_pedido'){
						solicitud.delivery = true
						message += 'Ok, perfecto.'
						solicitud.last_state = null
					}
					else if(solicitud.last_state == 'disponibilidad_singular' && cantidad){
						solicitud.productos = setRequestProduct(solicitud,solicitud.consultas.filter(v => String(v._id) == String(solicitud.last_product)),cantidad)
						message += "Ok, perfecto."
						solicitud.last_product = null
						solicitud.last_state = null
					}
					else
						message += 'Disculpa, no tenemos.'

					message += finalMessage(solicitud,'pedido')
				}
				else{
					
					if(data.length == 1){

						if(data[0].score >= 1 || solicitud.consultas.find(v => String(v._id) == String(data[0]._id))){

							if(!cantidad){
								var producto = solicitud.consultas.find(v => v._id == data[0]._id)
								if(!producto){
									message += `Ok, el costo es de ${data[0].currency}${data[0].price}. `
									if(data[0].description)
										message += `\n${data[0].description}\n`
								}
								message += "Me indicas la cantidad?"
								solicitud.last_state = "waiting_quantity"
								solicitud.last_product = data[0]._id
								solicitud.productos = setRequestProduct(solicitud,data,cantidad)
								// return
								// console.log()
							}
							else{
								message += "Ok, perfecto."
								solicitud.productos = setRequestProduct(solicitud,data,cantidad)
								message += finalMessage(solicitud, 'pedido')
							}


						}
						else{
							message += `No tenemos exactamente lo que quieres, ¿quizás quieres ${data[0].real_name}? Cuesta ${data[0].currency}${data[0].price}.`
							if(data[0].description)
								message += `\n${data[0].description}`
						}


					}
					else{
						message += "Tenemos disponible:"
						data.forEach(v => message += `\n- ${v.real_name} en ${v.currency}${v.price}` + (v.description ? `\n${v.description}\n` : ""))
						solicitud.consultas = [...solicitud.consultas,...data]
						solicitud.last_state = "disponibilidad_multiple"
						// message += "Puedes ser un poco más específico, o pedir 1 producto a la vez?"
					}
				}

			break;
		}

		saveMessage({
			message: mensaje,
			sender,
			action,
			data,
			message_sended: message
		})

		saveRequest(solicitud)

		var mensajes = []

		if(!activa){
			mensajes.push({
				message: `Hola, soy *${empresa.agent_name}*, el *asistente virtual* de *${empresa.name}*. `
			})
			// mensajes.push({
			// 	message: "Fui creado para facilitar la comunicación entre tú y la empresa, puedo ayudarte respondiendo sobre *disponibilidad* de productos y servicios, puedes hacerme *pedidos* y notificarme *pagos* de los mismos."
			// })
			// mensajes.push({
			// 	message: "Quiero que sepas que aún estoy aprendiendo el lenguaje humano y te podría ayudar mejor si me haces 1 pregunta o pedido a la vez, además escribir sin errores ortográficos, gracias!"
			// })
		}

		mensajes.push({message})

		res.json({
			data: mensajes
		})

	})

	var port = process.env.PORT || env.port

	var server = http.listen(port, function(){
	  console.log('listening on *:' + port);
	});

	server.timeout = 120000 * 5;
	server.keepAliveTimeout = 60000 * 2;

});