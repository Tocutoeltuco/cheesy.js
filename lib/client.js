const fetch = require('node-fetch'),
	EventEmitter = require('events');

const byteArray = require('./byteArray'),
	Connection = require('./connection.js');
	Room = require('./room.js'),
	RoomMessage = require('./roomMessage.js'),
	WhisperMessage = require('./whisperMessage.js'),
	Player = require('./player.js'),
	utils = require('./utils'),
	enums = require('./enums'),
	{identifiers, oldIdentifiers} = enums;

/** Represents a client that connects to Transformice. */
class Client extends EventEmitter {
	constructor(){
		super();
		this.loops = {};
		this.version = 0;
		this.connectionKey = '';
		this.authClient = 0;
		this.identificationKeys = [];
		this.msgKeys = [];
		this.authServer = 0;
		this.ports = [];
		this.host = '';
		this.tribulleID = 0;
		/**
		 * The online players when the bot log.
		 * @type {Number}
		 */
		this.onlinePlayers = 0;
		/**
		 * The client's room.
		 * @type {Room}
		 */
		this.room = null;
		/**
		 * The client's player.
		 * @type {Player}
		 */
		this.player = null;
		/**
		 * The client's ID.
		 * @type {Number}
		 */
		this.playerID = 0;
		/**
		 * The client's nickname.
		 * @type {String}
		 */
		this.nickname = '';
		/**
		 * The client's playing time.
		 * @type {Number}
		 */
		this.playingTime = 0;
		/**
		 * The connection time.
		 * @type {Number}
		 */
		this.connectionTime = 0;
		/**
		 * The client's community code.
		 * @type {enums.community}
		 */
		this.community = 0;
		/**
		 * The client's temporary code.
		 * @type {Number}
		 */
		this.pcode = 0;

		this.main = new Connection(this, 'main');
		this.bulle = new Connection(this, 'bulle');
	}

	/**
	 * Handles the old packets and emits events.
	 * @param {Connection} connection - The connection that received.
	 * @param {ByteArray} packet - The packet.
	 */
	handleOldPacket(conn, ccc, data){
		if (ccc == oldIdentifiers.roomPlayerLeft){
			const player = this.room.getPlayer('pcode', +data[0])
			if (player){
				this.room.removePlayer(player);
				/**
					* Emitted when a player left the room. 
					* @event Client#roomPlayerLeft
					* @property {Player} player - The player who left.
				*/
				this.emit("roomPlayerLeft", player);
			}
		}
		/**
			* Emitted when a new old packet received.
			* @event Client#rawOldPacket
			* @property {Connection} connection - The connection which sent the packet (`main` or `bulle`).
			* @property {enums.oldIdentifiers} ccc - The old identifier code of the packet.
			* @property {Array} data - The data.
		*/
		this.emit('rawOldPacket', conn, ccc, data);
	}

	/**
	 * Handles the known packets and emits events.
	 * @param {Connection} connection - The connection that received.
	 * @param {ByteArray} packet - The packet.
	 */
	handlePacket(conn, packet){
		const ccc = packet.readUnsignedShort();

		if (ccc == identifiers.oldPacket){
			const data = packet.readUTF().split(String.fromCharCode(1))
			const a = data.splice(0, 1)[0];
			const ccc = (a.charCodeAt(0) << 8) | a.charCodeAt(1);
			this.handleOldPacket(conn, ccc, data);

		}else if (ccc == identifiers.correctVersion){
			this.onlinePlayers = packet.readUnsignedInt();
			const community = packet.readUTF(),
				country = packet.readUTF();
			this.authServer = packet.readUnsignedInt();

			this.setSystemInfo('en', 'Linux', 'LNX 29,0,0,140');
			this.startHeartbeat();

		}else if (ccc == identifiers.loginReady){
			/**
				* Emitted when the client can login on the game. 
				* @event Client#loginReady
			*/
			this.emit('loginReady');

		}else if (ccc == identifiers.fingerprint){
			conn.fingerprint = packet.readByte();

		}else if (ccc == identifiers.bulleConnection){
			const timestamp = packet.readUnsignedInt(),
				playerId = packet.readUnsignedInt(),
				pcode = packet.readUnsignedInt(),
				host = packet.readUTF(),
				ports = packet.readUTF().split('-').map(port => ~~port);

			if (this.bulle.open)
				this.bulle.close();

			this.bulle = new Connection(this, 'bulle');
			this.bulle.connect(host, this.ports[0]);
			this.bulle.on('connect', () => {
				this.bulle.send(identifiers.bulleConnection, new byteArray().writeUnsignedInt(timestamp).writeUnsignedInt(playerId).writeUnsignedInt(pcode));
			});

		}else if (ccc == identifiers.logged) {
			this.playerID = packet.readUnsignedInt();
			this.nickname = packet.readUTF();
			this.playingTime = packet.readUnsignedInt();
			this.connectionTime = new Date().getTime();
			this.community = packet.readByte();
			this.pcode = packet.readUnsignedInt();
			/**
				* Emitted when the client has logged in. 
				* @event Client#logged
				* @property {String} nickname - The display nickname.
				* @property {Number} pcode - The client's code.
			*/
			this.emit('logged', this.nickname, this.pcode);
			
		}else if (ccc == identifiers.bulle){
			const code = packet.readUnsignedShort();

			if (code == 3){
				/**
					* Emitted when the client is connected to the community platform.
					* @event Client#ready
				*/
				this.emit('ready');
			}else{
				this.handleTribulle(code, packet);
			};

		}else if (ccc == identifiers.luaChatLog){
			/**
				* Emitted when the client receives lua logs or errors from `#Lua` chat.
				* @event Client#luaLog
				* @property {String} message - a log message
			*/
			this.emit('luaLog', packet.readUTF());


		}else if (ccc == identifiers.roomMessage){
			const player = this.room.getPlayer('pcode', packet.readUnsignedInt()),
				nickname = packet.readUTF(),
				community = packet.readUnsignedByte(),
				content = packet.readUTF();
			const message = new RoomMessage(this, player, community, content);
			/**
				* Emitted when a player sends a message in the room.
				* @event Client#roomMessage
				* @property {RoomMessage} message - The message.
			*/
			this.emit('roomMessage', message);

		}else if (ccc == identifiers.roomChange){
			const before = this.room;
			const isPublic = packet.readBoolean(), 
				name = packet.readUTF();
			this.room = new Room(this, isPublic, name);
			/**
				* Emitted when the room is changed. 
				* @event Client#roomChange
				* @property {Room} before - The old room.
				* @property {Room} after - The new room.
				* @example 
				* client.on('roomChange', (before, after) => {
				* 	console.log('The room changed from '+before.name+' to '+after.name);
				* })
			*/
			this.emit("roomChange", before, this.room)

		}else if (ccc == identifiers.roomPlayerList){
			const before = this.room.playerList;
			this.room.playerList = {};
			const length = packet.readUnsignedShort();
			for (let i = 0; i < length; i++) {
				const player = new Player().read(packet);
				this.room.playerList[player.pcode] = player;
			}
			this.player = this.room.getPlayer('pcode', this.pcode);
			/**
				* Emitted when the room playerList is updated. 
				* @event Client#roomUpdate
				* @property {Object} before - The old playerList.
				* @property {Object} after - The new playerList.
			*/
			this.emit("roomUpdate", before, this.room.playerList);

		}else if (ccc == identifiers.roomNewPlayer){
			const player = new Player().read(packet);
			if (this.room.playerList[player.pcode]){
				/**
					* Emitted when the room playerList is updated. 
					* @event Client#roomPlayerUpdate
					* @property {Player} before - Old player data.
					* @property {Player} after - New player data.
				*/
				this.emit("roomPlayerUpdate", this.room.playerList[player.pcode], player);
			}else{
				/**
					* Emitted when a new player has joined. 
					* @event Client#roomPlayerJoin
					* @property {Player} player - The player.
				*/
				this.emit("roomPlayerJoin", player);
			}
			this.room.updatePlayer(player);

		}else{
			//console.log(c, cc, packet.buffer);
		}
		/**
			* Emitted when a new packet received from main or bulle connection.
			* @event Client#rawPacket
			* @property {Connection} connection - The connection which sent the packet (`main` or `bulle`).
			* @property {enums.identifiers} ccc - The identifier code of the packet.
			* @property {ByteArray} packet - The packet.
		*/
		this.emit('rawPacket', conn, ccc, packet);
	}

	/**
	 * Handles the community platform packets and emits events.
	 * @param {ByteArray} packet - The community platform code.
	 * @param {ByteArray} packet - The community platform packet.
	 */
	handleTribulle(code, packet){
		if (code == 66){
			const author = packet.readUTF(),
			community = packet.readUnsignedInt(),
			sentTo = packet.readUTF(),
			content = packet.readUTF();
			const message = new WhisperMessage(this, author, community, sentTo, content);
			/**
				* Emitted when a player sends a whisper message to the client.
				* @event Client#whisper
				* @property {WhisperMessage} message - The message.
			*/
			this.emit('whisper', message);
		}
		/**
			* Emitted when a new community platform packet received.
			* @event Client#rawTribulle
			* @property {Number} code - The community platform code.
			* @property {ByteArray} packet - The packet.
		*/
		this.emit('rawTribulle', code, packet);
	}

	/**
	 * Sends a packet to the community platform (tribulle).
	 * @param {Number} code - The community platform code.
	 * @param {ByteArray} packet - The community platform packet.
	 */
	sendTribullePacket(code, packet){
		this.tribulleID = (this.tribulleID % 0x100000000) + 1
		const p = new byteArray().writeShort(code).writeUnsignedInt(this.tribulleID)
		p.writeBytes(packet);
		this.main.send(identifiers.bulle, p, enums.cipherMethod.xor)
	}

	/**
	 * Log in to the game.
	 * @param {String} nickname - The client nickname.
	 * @param {String} password - The client password.
	 * @param {String} [room="1"] - The starting room.
	 */
	login(nickname, password, room="1"){
		const p = new byteArray().writeUTF(nickname).writeUTF(utils.SHAKikoo(password));
		p.writeUTF("app:/TransformiceAIR.swf/[[DYNAMIC]]/2/[[DYNAMIC]]/4").writeUTF(room);
		p.writeUnsignedInt(parseInt(BigInt(this.authServer) ^ BigInt(this.authClient)));
		this.main.send(identifiers.loginSend, p, enums.cipherMethod.xxtea);
	}

	/**
	 * Sends Handshake.
	 * @param {Number} version - The version.
	 * @param {String} key - The Connection key.
	 */
	sendHandshake(version, key){
		const p = new byteArray();
		p.writeShort(version);
		p.writeUTF("en");
		p.writeUTF(key);
		p.writeUTF('Desktop').writeUTF('-').writeInt(0x1fbd);
		p.writeUTF('').writeUTF('74696720697320676f6e6e61206b696c6c206d7920626f742e20736f20736164');
		p.writeUTF('A=t&SA=t&SV=t&EV=t&MP3=t&AE=t&VE=t&ACC=t&PR=t&SP=f&SB=f&DEB=f&V=LNX 29,0,0,140&M=Adobe Linux&R=1920x1080&COL=color&AR=1.0&OS=Linux&ARCH=x86&L=en&IME=t&PR32=t&PR64=t&LS=en-US&PT=Desktop&AVD=f&LFD=f&WD=f&TLS=t&ML=5.1&DP=72');
		p.writeInt(0).writeInt(0x1234).writeUTF('');
		this.main.send(identifiers.handshake, p);
	}

	/**
	 * Sets the community of the bot.
	 * @param {enums.community} [id=enums.community.en] - The community id.
	 */
	setCommunity(id=enums.community.en){
		const p = new byteArray().writeByte(id).writeByte(0);
		this.main.send(identifiers.community, p);
	}

	setSystemInfo(langue, sys, version){
		const p = new byteArray().writeUTF(langue).writeUTF(sys).writeUTF(version);
		this.main.send(identifiers.os, p);
	}

	/**
	 * Joins the tribe house.
	 */
	joinTribeHouse(){
		this.main.send(identifiers.joinTribeHouse, new byteArray());
	}

	/**
	 * Load a lua script in the room.
	 * @param {String} script - The script code.
	 */
	loadLua(script){
		const length = Buffer.byteLength(script);
		const p = new byteArray().writeUnsignedShort(length >> 8).writeUnsignedByte(length & 255).writeMultiByte(script);
		this.bulle.send(identifiers.loadLua, p);
	}

	/**
	 * Sends a message to the client's room.
	 * @param {String} message - The message.
	 */
	sendRoomMessage(message){
		this.bulle.send(identifiers.roomMessage, new byteArray().writeUTF(message), enums.cipherMethod.xor);
	}

	/**
	 * Sends a server command.
	 * @param {String} message - The command message (without the `/`).
	 * @exemple
	 * client.sendCommand('mod');
	 */
	sendCommand(message){
		this.main.send(identifiers.command, new byteArray().writeUTF(message), enums.cipherMethod.xor)
	}

	/**
	 * Sends a whisper message to a player.
	 * @param {String} nickname - The nickname of the player.
	 * @param {String} message - The message.
	 */
	sendWhisper(nickname, message){
		this.sendTribullePacket(52, new byteArray().writeUTF(nickname.toLowerCase()).writeUTF(message))
	}

	/**
	 * Sends a packet every 15 seconds to stay connected to the game.
	 */
	startHeartbeat(){
		this.main.send(identifiers.heartbeat, new byteArray());
		this.loops.heartbeat = setInterval(() => {
			this.main.send(identifiers.heartbeat, new byteArray());
			if (this.bulle.open)
				this.bulle.send(identifiers.heartbeat, new byteArray());
		}, 1000*15)
	}

	/**
	 * Starts the client.
	 * @param {String} api_tfmid - Your Transformice id.
	 * @param {String} api_token - Your token.
	 */
	async start(tfmid, token){
		const response = await fetch('https://api.tocuto.tk/get_transformice_keys.php?tfmid='+tfmid+'&token='+token);
		const result = await response.json();
		if (result.success) {
			if (!result.internal_error) {
				this.version = result.version;
				this.connectionKey = result.connection_key;
				this.ports = result.ports;
				this.host = result.ip;
				this.authClient = result.auth_key;
				this.identificationKeys = result.identification_keys;
				this.msgKeys = result.msg_keys;
				this.main.connect(this.host, this.ports[0]);
				this.main.on('connect', () => {
					this.sendHandshake(this.version, this.connectionKey);
				});
			}else{
				if (result.internal_error_step == 2)
					throw new Error("The game might be in maintenance mode.");
				throw new Error('An internal error occur: '+internal_error_step);
			}
		}else{
			throw new Error('Can\'t get the keys : '+result.error);
		}
	}

	/**
	 * Disconnects the client.
	 */
	disconnect(){
		for (let loop in this.loops){
			clearInterval(this.loops[loop]);
		}
		this.main.close();
		this.bulle.close();
		/**
			* Emitted when the client has disconnect. 
			* @event Client#disconnect
		*/
		this.emit('disconnect');
	}

}

Client.enums = enums;
module.exports = Client;
