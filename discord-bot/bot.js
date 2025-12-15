/**
 * Medical OP Systems - Discord Bot
 * For Railway 24/7 Deployment
 * 
 * Features:
 * - Read messages from OP Queue channel
 * - Send/Edit story updates
 * - Detect user roles
 * - Real-time message handling
 */

require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const admin = require('firebase-admin');

// --- Firebase Initialization ---
let db;
try {
    // For Railway: Use base64 encoded service account
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        const serviceAccount = JSON.parse(
            Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString()
        );
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } else {
        // For local testing with default credentials
        admin.initializeApp();
    }
    db = admin.firestore();
    console.log('✅ Firebase initialized');
} catch (error) {
    console.error('❌ Firebase init error:', error.message);
}

// --- Configuration ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const OP_CHANNEL_ID = process.env.OP_CHANNEL_ID;
const STORY_CHANNEL_ID = process.env.STORY_CHANNEL_ID;

// Role IDs (ordered by rank)
const ROLE_IDS = {
    'SSS+': process.env.ROLE_SSS_PLUS_ID,
    'SSS': process.env.ROLE_SSS_ID,
    'SS': process.env.ROLE_SS_ID,
    'A': process.env.ROLE_A_ID,
    'B': process.env.ROLE_B_ID,
    'C': process.env.ROLE_C_ID,
    'D': process.env.ROLE_D_ID
};

// Role colors for embed
const ROLE_COLORS = {
    'SSS+': 0xFFD700, // Gold
    'SSS': 0xFF6B6B,  // Red
    'SS': 0xC77DFF,   // Purple  
    'A': 0x00FF7F,    // Green
    'B': 0x00BFFF,    // Blue
    'C': 0x87CEEB,    // Light Blue
    'D': 0x808080     // Gray
};

// --- Discord Client ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// --- Helper Functions ---

// Get user's highest role badge
function getUserBadge(member) {
    for (const [roleName, roleId] of Object.entries(ROLE_IDS)) {
        if (roleId && member.roles.cache.has(roleId)) {
            return roleName;
        }
    }
    return null;
}

// Format role badge
function formatBadge(badge) {
    const badges = {
        'SSS+': '👑',
        'SSS': '⭐',
        'SS': '💎',
        'A': '🟢',
        'B': '🔵',
        'C': '🟡',
        'D': '⚪'
    };
    return badges[badge] || '';
}

// --- Discord ID and IC Phone Lookup Cache ---
let discordIdCache = {};
let icPhoneCache = {}; // IC phone number cache
let discordIdCacheTime = 0;
const DISCORD_ID_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Load all Discord IDs and IC Phones from op_users collection
async function loadDiscordIdCache() {
    if (!db) return;

    const now = Date.now();
    if (now - discordIdCacheTime < DISCORD_ID_CACHE_TTL && Object.keys(discordIdCache).length > 0) {
        return; // Cache still valid
    }

    try {
        const snapshot = await db.collection('op_users').get();
        discordIdCache = {};
        icPhoneCache = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            const discordId = data.discordId;
            const icPhone = data.icPhone; // IC phone number

            // Store by document ID (username)
            const username = doc.id;
            if (username) {
                const key = username.toLowerCase();
                if (discordId) discordIdCache[key] = discordId;
                if (icPhone) icPhoneCache[key] = icPhone;
            }

            // Store by firstName
            const firstName = data.firstName;
            if (firstName) {
                const key = firstName.toLowerCase();
                if (discordId) discordIdCache[key] = discordId;
                if (icPhone) icPhoneCache[key] = icPhone;
            }

            // Store by fullName
            const fullName = data.fullName;
            if (fullName) {
                const key = fullName.toLowerCase();
                if (discordId) discordIdCache[key] = discordId;
                if (icPhone) icPhoneCache[key] = icPhone;
            }

            // Store by first part of fullName (in case firstName is not set)
            if (fullName && !firstName) {
                const firstPart = fullName.split(' ')[0];
                if (firstPart) {
                    const key = firstPart.toLowerCase();
                    if (discordId) discordIdCache[key] = discordId;
                    if (icPhone) icPhoneCache[key] = icPhone;
                }
            }
        });

        discordIdCacheTime = now;
        console.log(`📋 Loaded ${Object.keys(discordIdCache).length} Discord IDs and ${Object.keys(icPhoneCache).length} IC phones into cache`);
    } catch (error) {
        console.error('❌ Failed to load Discord ID cache:', error);
    }
}

// Get Discord ID by name (case-insensitive, tries multiple strategies)
function getDiscordIdByName(name) {
    if (!name) return null;

    const nameLower = name.toLowerCase();

    // Strategy 1: Direct lookup (exact match)
    if (discordIdCache[nameLower]) {
        return discordIdCache[nameLower];
    }

    // Strategy 2: Try first name only (split by space)
    const firstName = name.split(' ')[0].toLowerCase();
    if (firstName && discordIdCache[firstName]) {
        return discordIdCache[firstName];
    }

    // Strategy 3: Not found
    return null;
}

// Format name as Discord mention if linked, otherwise plain text
function formatWithMention(name, forceText = false) {
    if (forceText || !name) return name || '';
    const discordId = getDiscordIdByName(name);
    return discordId ? `<@${discordId}>` : name;
}

// Get IC phone by name (case-insensitive, tries multiple strategies)
function getIcPhoneByName(name) {
    if (!name) return null;

    const nameLower = name.toLowerCase();

    // Strategy 1: Direct lookup (exact match)
    if (icPhoneCache[nameLower]) {
        return icPhoneCache[nameLower];
    }

    // Strategy 2: Try first name only (split by space)
    const firstName = name.split(' ')[0].toLowerCase();
    if (firstName && icPhoneCache[firstName]) {
        return icPhoneCache[firstName];
    }

    // Strategy 3: Not found
    return null;
}

// Format name with IC phone if available (for OP, Sup OP, On Duty)
function formatNameWithIC(name, options = {}) {
    if (!name) return name || '';
    const icPhone = getIcPhoneByName(name);
    const displayName = options.useMention ? formatWithMention(name) : name;
    return icPhone ? `${displayName} (📞 ${icPhone})` : displayName;
}

// Thai month abbreviations to month number (0-indexed)
const THAI_MONTHS = {
    'ม.ค.': 0, 'ก.พ.': 1, 'มี.ค.': 2, 'เม.ย.': 3,
    'พ.ค.': 4, 'มิ.ย.': 5, 'ก.ค.': 6, 'ส.ค.': 7,
    'ก.ย.': 8, 'ต.ค.': 9, 'พ.ย.': 10, 'ธ.ค.': 11
};

// Parse Thai date format "อ. 15 ธ.ค. 2568" or "15 ธ.ค. 2568"
function parseThaiDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;

    // Match pattern: optional day name + day number + thai month + thai year
    // e.g., "อ. 15 ธ.ค. 2568" or "15 ธ.ค. 2568"
    const match = dateStr.match(/(\d{1,2})\s+(\S+\.?)\s+(\d{4})/);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const monthStr = match[2];
    const thaiYear = parseInt(match[3], 10);

    // Convert Thai month to number
    const month = THAI_MONTHS[monthStr];
    if (month === undefined) return null;

    // Convert Thai year (พ.ศ.) to AD year (ค.ศ.)
    const year = thaiYear - 543;

    return new Date(year, month, day);
}

// Filter items to only show today's items (Bangkok timezone)
function filterTodayItems(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const now = new Date();
    const bangkokOffset = 7 * 60; // UTC+7 in minutes
    const localOffset = now.getTimezoneOffset();
    const bangkokTime = new Date(now.getTime() + (bangkokOffset + localOffset) * 60000);

    // Get today's date string in YYYY-MM-DD format for comparison
    const todayStr = bangkokTime.toISOString().split('T')[0]; // e.g., "2025-12-14"

    console.log(`📅 Filtering for today: ${todayStr}`);

    return items.filter(item => {
        // Priority 1: Check storyDate (stored as YYYY-MM-DD from input type="date")
        if (item.storyDate && typeof item.storyDate === 'string') {
            // storyDate is in YYYY-MM-DD format (e.g., "2025-12-15")
            const itemDateStr = item.storyDate;
            const isToday = itemDateStr === todayStr;
            console.log(`  Story: ${item.partyA} vs ${item.partyB}, storyDate: ${itemDateStr}, isToday: ${isToday}`);
            return isToday;
        }

        // Priority 2: Check createdAt timestamp
        if (item.createdAt) {
            const itemDate = new Date(item.createdAt);
            if (!isNaN(itemDate.getTime())) {
                const itemDateStr = itemDate.toISOString().split('T')[0];
                return itemDateStr === todayStr;
            }
        }

        // Priority 3: If only startTime (HH:MM) without storyDate, assume it's old/today
        if (item.startTime && typeof item.startTime === 'string') {
            if (item.startTime.match(/^\d{2}:\d{2}$/)) {
                // No storyDate means older story, include it
                return true;
            }
        }

        // If we can't determine the date, don't include it
        return false;
    });
}

// Format status icons for On Duty users
// Based on OP System buttons: ✓ รับเคส | 🔧 รอเคสแก้ | ❌ ไม่รับเคส | ⏳ AFK | 📤 Off Duty
function formatStatus(status) {
    const statusIcons = {
        'available': '',                    // ✓ พร้อมรับเคส (default, no icon needed)
        'in_queue': '',                     // ถึงคิว - แสดงด้วย 📍 แทน
        'waiting_fix': '🔧',                // 🔧 รอเคสแก้
        'not_accepting': '🚫',              // ❌ ไม่รับเคส
        'afk': '⏳',                        // ⏳ AFK
        'in_story': '⚔️',                  // กำลังไปสตอรี่
        'in_event': '🎉',                   // อยู่ใน Event
        'break': '☕',                      // พักเบรค
        'busy': '💼'                        // ติดธุระ
    };
    return statusIcons[status] || '';
}

// Log to Firestore
async function logToFirestore(level, message) {
    if (!db) return;
    try {
        await db.collection('bot_logs').add({
            level,
            message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            source: 'railway-bot'
        });
    } catch (e) {
        console.error('Log error:', e.message);
    }
}

// --- Event: Ready ---
client.once('ready', async () => {
    console.log(`✅ Bot Ready: ${client.user.tag}`);
    console.log(`📡 Guild ID: ${GUILD_ID}`);
    console.log(`📺 Channels: OP=${OP_CHANNEL_ID}, Story=${STORY_CHANNEL_ID}`);

    await logToFirestore('INFO', `Bot started: ${client.user.tag}`);

    // Set status
    client.user.setActivity('Medical OP Systems', { type: 3 }); // Watching

    // Load Discord ID cache for mentions
    await loadDiscordIdCache();

    // Start Firestore listener for story updates
    startStoryListener();

    // Start midnight refresh scheduler
    startMidnightScheduler();
});

// --- Midnight Scheduler ---
// Automatically refresh Discord messages at midnight (Bangkok time)
// This ensures stories for the new day are shown automatically
function startMidnightScheduler() {
    console.log('⏰ Starting midnight scheduler...');

    // Calculate time until next midnight (Bangkok time, UTC+7)
    function scheduleNextMidnight() {
        const now = new Date();
        const bangkokOffset = 7 * 60; // UTC+7 in minutes
        const localOffset = now.getTimezoneOffset();
        const bangkokTime = new Date(now.getTime() + (bangkokOffset + localOffset) * 60000);

        // Calculate next midnight in Bangkok
        const nextMidnight = new Date(bangkokTime);
        nextMidnight.setDate(nextMidnight.getDate() + 1);
        nextMidnight.setHours(0, 0, 0, 0);

        // Convert back to local time for setTimeout
        const msUntilMidnight = nextMidnight.getTime() - bangkokTime.getTime();

        console.log(`⏰ Next midnight refresh in ${Math.round(msUntilMidnight / 60000)} minutes`);

        setTimeout(async () => {
            console.log('🌙 Midnight reached! Refreshing Discord messages...');
            await refreshDiscordMessages();

            // Schedule next midnight
            scheduleNextMidnight();
        }, msUntilMidnight);
    }

    scheduleNextMidnight();
}

// Refresh Discord messages by fetching current data and updating
async function refreshDiscordMessages() {
    if (!db) {
        console.log('⚠️ Firebase not available for midnight refresh');
        return;
    }

    try {
        const doc = await db.collection('op_data').doc('current').get();
        if (!doc.exists) {
            console.log('⚠️ No op_data/current document for midnight refresh');
            return;
        }

        const data = doc.data();
        console.log('🔄 Midnight refresh: updating Discord messages...');

        await updateOPChannelMessage(data);
        await updateStoryChannelMessage(data);

        await logToFirestore('INFO', 'Midnight refresh completed - Discord messages updated');
        console.log('✅ Midnight refresh completed');
    } catch (error) {
        console.error('❌ Midnight refresh error:', error);
        await logToFirestore('ERROR', `Midnight refresh failed: ${error.message}`);
    }
}

// --- Event: Error ---
client.on('error', (error) => {
    console.error('❌ Discord Error:', error);
    logToFirestore('ERROR', `Discord error: ${error.message}`);
});

// --- Event: Message Create ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Handle OP Channel messages
    if (message.channelId === OP_CHANNEL_ID) {
        console.log(`📩 OP Channel Message from ${message.author.username}: ${message.content.substring(0, 50)}...`);

        // Parse OP-related commands or data
        // Example: Detect shift start messages
        if (message.content.includes('เริ่มกะ') || message.content.includes('Start Shift')) {
            const member = message.member;
            const badge = getUserBadge(member);

            // Log to Firestore for the web app to pick up
            if (db) {
                try {
                    await db.collection('discord_op_messages').add({
                        type: 'shift_start',
                        authorId: message.author.id,
                        authorName: member.displayName,
                        badge: badge,
                        content: message.content,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.log('✅ Logged shift start message');
                } catch (e) {
                    console.error('❌ Failed to log message:', e);
                }
            }
        }
    }
});

// --- Firestore Listener for Story Updates ---
function startStoryListener() {
    if (!db) {
        console.log('⚠️ Firebase not available, skipping Firestore listener');
        return;
    }

    console.log('👀 Starting Firestore listener for op_data/current...');

    db.collection('op_data').doc('current').onSnapshot(async (doc) => {
        if (!doc.exists) return;

        const data = doc.data();
        // FIXED: Use "cases" not "stories"
        const cases = data.cases || [];
        const currentOP = data.currentOP || 'ไม่มี';
        const onDutyCount = (data.onDuty || []).length;

        console.log(`📊 Update: ${cases.length} cases, OP: ${currentOP}, OnDuty: ${onDutyCount}`);

        // Send/Edit messages to BOTH channels
        await updateOPChannelMessage(data);      // ห้องรันคิว OP
        await updateStoryChannelMessage(data);   // ห้องแจ้งเคสสตอรี่ (เฉพาะสตอรี่)
    }, (error) => {
        console.error('❌ Firestore listener error:', error);
    });

    // Also listen for shift summaries
    startSummaryListener();

    // Also listen for closed cases (to post history)
    startClosedCaseListener();
}

// --- Listen for Shift Summary Posts ---
function startSummaryListener() {
    if (!db) return;

    console.log('👀 Starting Firestore listener for shift_summaries...');

    // Listen for new summaries added to the collection
    db.collection('shift_summaries')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const summary = change.doc.data();

                    // Check if already posted to Discord
                    if (summary.postedToDiscord) return;

                    console.log('📝 New shift summary detected!');
                    await postSummaryToDiscord(summary, change.doc.id);
                }
            });
        }, (error) => {
            console.error('❌ Summary listener error:', error);
        });
}

// --- Listen for Closed Cases (post history to story channel) ---
function startClosedCaseListener() {
    if (!db) return;

    console.log('👀 Starting Firestore listener for closed_cases...');

    // Listen for new closed cases
    db.collection('closed_cases')
        .orderBy('closedAt', 'desc')
        .limit(1)
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const closedCase = change.doc.data();

                    // Check if already posted to Discord
                    if (closedCase.postedToDiscord) return;

                    console.log('📖 Closed case detected! Posting history...');
                    await postClosedCaseHistory(closedCase, change.doc.id);
                }
            });
        }, (error) => {
            console.error('❌ Closed case listener error:', error);
        });
}

// --- Post Closed Case History to Story Channel ---
async function postClosedCaseHistory(closedCase, docId) {
    try {
        const channel = await client.channels.fetch(STORY_CHANNEL_ID);
        if (!channel) {
            console.error('❌ Story channel not found');
            return;
        }

        const partyA = closedCase.partyA || '?';
        const partyB = closedCase.partyB || '?';
        const location = closedCase.location || '-';
        const startTime = closedCase.startTime || '-';
        const storyDate = closedCase.storyDate || '';
        const medics = closedCase.medics || [];
        // Use Discord mentions for story medics (if linked)
        const mainMedicRaw = medics[0] || '-';
        const mainMedic = mainMedicRaw !== '-' ? formatWithMention(mainMedicRaw) : '-';
        const wardNumber = closedCase.wardNumber || closedCase.ward || '-'; // เลขวอ
        const council = closedCase.council || closedCase.site || '-'; // สภาที่ดูแล
        const closedAt = closedCase.closedAt ? new Date(closedCase.closedAt).toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Bangkok'
        }) : '-';

        // Simple one-line format for story history
        let message = '';
        message += `⚔️ **${partyA} VS ${partyB}**\n`;
        message += `📍 ${location} | ⏰ ${startTime}→${closedAt}\n`;
        message += `👨‍⚕️ ${mainMedic}`;
        if (wardNumber !== '-') message += ` |  วอ ${wardNumber}`;
        if (council !== '-') message += ` | 🏛️ ${council}`;
        message += '\n';

        // Send to Discord
        await channel.send(message);
        console.log('✅ Closed case history posted');

        // Mark as posted
        await db.collection('closed_cases').doc(docId).update({
            postedToDiscord: true,
            postedAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error('❌ postClosedCaseHistory error:', error);
    }
}

// --- Post Shift Summary to Discord ---
async function postSummaryToDiscord(summary, docId) {
    try {
        const channel = await client.channels.fetch(OP_CHANNEL_ID);
        if (!channel) {
            console.error('❌ OP Channel not found');
            return;
        }

        // Build summary message
        const opName = summary.op || 'ไม่ระบุ';
        const supOP = summary.supOP || '-';
        const shiftType = summary.type || 'end_shift'; // end_shift, handover, force_end
        const startTime = summary.startTime || '';
        const endTime = summary.endTime || '';
        const duration = summary.duration || '';
        const onDutyList = summary.onDuty || [];
        const offDutyList = summary.offDuty || [];
        const storiesList = summary.stories || [];

        // Type label
        const typeLabels = {
            'end_shift': '🏁 จบกะ',
            'handover': '🔄 ส่งต่อ OP',
            'force_end': '⚠️ บังคับจบกะ',
            'request': '📋 Request OP'
        };
        const typeLabel = typeLabels[shiftType] || '📋 สรุปกะ';

        // Format date
        const now = new Date();
        const dateStr = now.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        // Use Discord mentions for OP and Sup OP (if linked)
        const opDisplay = formatWithMention(opName);
        const supOPDisplay = supOP && supOP !== '-' ? formatWithMention(supOP) : null;

        let message = '';
        message += `**${typeLabel}**\n`;
        message += '════════════════════\n';
        message += `📅 วันที่: ${dateStr}\n`;
        message += `👤 OP: ${opDisplay}\n`;
        if (supOPDisplay) {
            message += `👥 Support OP: ${supOPDisplay}\n`;
        }
        // Show times - use current time as end if not provided
        const displayStartTime = startTime || '-';
        const displayEndTime = endTime || now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
        message += `⏰ เวลา: ${displayStartTime} - ${displayEndTime}`;
        if (duration) message += ` (${duration})`;
        message += '\n';
        message += '════════════════════\n\n';

        // On Duty List
        message += `✅ **On Duty (${onDutyList.length} คน):**\n`;
        if (onDutyList.length > 0) {
            onDutyList.forEach(m => {
                const name = m.name || m;
                const badge = formatBadge(m.badge);
                message += `• ${badge} ${name}\n`;
            });
        } else {
            message += '_ไม่มี_\n';
        }
        message += '────────────────────\n\n';

        // Off Duty List
        message += `❌ **Off Duty (${offDutyList.length} คน):**\n`;
        if (offDutyList.length > 0) {
            offDutyList.slice(0, 15).forEach(m => {
                const name = m.name || m;
                message += `• ${name}\n`;
            });
            if (offDutyList.length > 15) {
                message += `_...และอีก ${offDutyList.length - 15} คน_\n`;
            }
        } else {
            message += '_ไม่มี_\n';
        }
        message += '────────────────────\n\n';

        // Stories - separate ongoing and completed
        const ongoingStories = (summary.ongoingStories || []);  // Stories still in progress
        const closedStories = storiesList || []; // Completed stories from this shift

        // Filter: only show stories that were STARTED and CLOSED
        const startedAndClosed = closedStories.filter(s => s.startTime && s.startTime !== '-');

        // Closed Stories (started AND completed during shift)
        message += `⚔️ **สตอรี่ที่เริ่มแล้ว และ ปิดแล้ว (${startedAndClosed.length} เคส):**\n`;
        if (startedAndClosed.length > 0) {
            startedAndClosed.forEach((s, i) => {
                const partyA = s.partyA || '?';
                const partyB = s.partyB || '?';
                const medics = s.medics || s.assignedMedics || [];
                const rawMainMedic = medics[0]?.name || medics[0] || '-';
                // Use Discord mentions for story medics (if linked)
                const mainMedic = rawMainMedic !== '-' ? formatWithMention(rawMainMedic) : '-';
                const supportMedics = medics.slice(1).map(m => {
                    const name = m.name || m;
                    return formatWithMention(name);
                }).join(', ');

                message += `**สตอรี่ #${i + 1}** ระหว่าง ${partyA} VS ${partyB}\n`;
                message += `แพทย์ผู้รับผิดชอบ : ${mainMedic}\n`;
                if (supportMedics) {
                    message += `แพทย์ช่วยเหลือ : ${supportMedics}\n`;
                }
                message += '\n';
            });
        } else {
            message += '_ไม่มีสตอรี่ที่เริ่มแล้วและปิดแล้ว_\n';
        }

        // Ongoing Stories (still in progress when shift ended)
        if (ongoingStories.length > 0) {
            message += '\n⚠️ **สตอรี่ที่ยังดำเนินอยู่ (' + ongoingStories.length + ' เคส):**\n';
            ongoingStories.forEach((s, i) => {
                const partyA = s.partyA || '?';
                const partyB = s.partyB || '?';
                const medics = s.medics || [];
                const mainMedic = medics[0] || 'ยังไม่มี';

                message += `**#${i + 1}** ${partyA} VS ${partyB}`;
                if (mainMedic !== 'ยังไม่มี') {
                    message += ` - 👨‍⚕️ ${mainMedic}`;
                }
                message += ' _(ยังดำเนินอยู่)_\n';
            });
        }

        message += '\n════════════════════';

        // Get old message ID to delete it
        const configDoc = await db.collection('config').doc('discord_message').get();
        const oldMessageId = configDoc.exists ? configDoc.data().opChannelMessageId : null;

        // Delete old OP status message (so only Summary and Waiting remain)
        if (oldMessageId) {
            try {
                const oldMsg = await channel.messages.fetch(oldMessageId);
                await oldMsg.delete();
                console.log('🗑️ Old OP status message deleted');
            } catch (e) {
                console.log('⚠️ Could not delete old message (might already be deleted)');
            }
        }

        // Clear OP channel message ID only (NOT story - story channel manages its own)
        await db.collection('config').doc('discord_message').update({
            opChannelMessageId: null,
            summaryJustPosted: true  // Flag to prevent duplicate "waiting" message
        });
        console.log('🔄 Cleared OP message ID for fresh start');

        // Send summary to Discord
        await channel.send(message);
        console.log('✅ Summary posted to Discord');

        // Format date for waiting message
        const waitNow = new Date();
        const waitDateStr = waitNow.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        // Send "waiting for OP" message right after summary (correct order)
        let waitingMessage = '**📋 สรุปการเข้าเวร OP**\n';
        waitingMessage += '────────────────────\n';
        waitingMessage += `📅 ${waitDateStr}\n`;
        waitingMessage += '────────────────────\n\n';
        waitingMessage += '🚫 **ไม่มีกะ ณ ขณะนี้**\n\n';
        waitingMessage += '_รอ OP เปิดกะ..._\n';

        const waitingMsg = await channel.send(waitingMessage);
        console.log('✅ Waiting message posted after summary');

        // Store the new message ID
        await db.collection('config').doc('discord_message').update({
            opChannelMessageId: waitingMsg.id,
            summaryJustPosted: false  // Clear the flag
        });

        // Mark as posted
        await db.collection('shift_summaries').doc(docId).update({
            postedToDiscord: true,
            postedAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error('❌ postSummaryToDiscord error:', error);
    }
}

// --- Update OP Channel Message (Queue, On Duty, Off Duty, AFK) ---
async function updateOPChannelMessage(data) {
    try {
        const channel = await client.channels.fetch(OP_CHANNEL_ID);
        if (!channel) {
            console.error('❌ OP channel not found');
            return;
        }

        // Reload Discord ID cache to get latest linked accounts
        await loadDiscordIdCache();

        const currentOP = data.currentOP || 'ไม่มี';
        const supOP = data.supOP || null;
        const onDuty = data.onDuty || [];  // Array of strings (names)
        const offDuty = data.offDuty || []; // Array of strings (names)
        const afkList = data.afk || [];     // OP uses "afk" not "afkList"
        const lastModified = data._lastModified || null;
        const medicStatuses = data.medicStatuses || {}; // Status per medic

        // Format date (use Bangkok timezone)
        const now = new Date();
        const dateStr = now.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Bangkok'
        });

        let message = '';

        // Check if no active shift (OP = 'ไม่มี')
        if (currentOP === 'ไม่มี') {
            // Check if summary was just posted (to avoid duplicate "waiting" message)
            const configDoc = await db.collection('config').doc('discord_message').get();
            const configData = configDoc.exists ? configDoc.data() : {};

            // Skip if summary was just posted OR if we already have a waiting message
            if (configData.summaryJustPosted || configData.opChannelMessageId) {
                console.log('⏭️ Waiting message already posted by summary function, skipping...');
                return;
            }

            message = '**📋 สรุปการเข้าเวร OP**\n';
            message += '────────────────────\n';
            message += `📅 ${dateStr}\n`;
            message += '────────────────────\n\n';
            message += '🚫 **ไม่มีกะ ณ ขณะนี้**\n\n';
            message += '_รอ OP เปิดกะ..._\n';
        } else {
            // Format OP and Sup OP with Discord mentions and IC phone (if available)
            const opDisplay = formatNameWithIC(currentOP, { useMention: true });
            const supOPDisplay = supOP ? formatNameWithIC(supOP, { useMention: true }) : null;

            // Build message for OP Channel (Queue info)
            message = '**สรุปการเข้าเวร OP**\n';
            message += '────────────────────\n';
            message += `📅 วันที่: ${dateStr}\n`;
            message += `👤 OP: ${opDisplay}\n`;
            if (supOPDisplay) {
                message += `👥 Support OP: ${supOPDisplay}\n`;
            }
            if (lastModified && typeof lastModified === 'number') {
                const shiftDate = new Date(lastModified);
                const timeStr = shiftDate.toLocaleTimeString('th-TH', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Bangkok'
                });
                message += `⏰ เวลา: ${timeStr}\n`;
            }
            message += '────────────────────\n\n';

            // On Duty List
            message += `✅ **On Duty (${onDuty.length} คน):**\n`;
            if (onDuty.length > 0) {
                onDuty.forEach((name) => {
                    const status = medicStatuses[name] || '';
                    let icon = '';
                    if (status === 'accept') {
                        icon = ' 📍'; // กด ✓ รับเคส = ถึงคิว
                    } else if (status === 'waitfix') {
                        icon = ' ⏳'; // รอเคสแก้
                    } else if (status === 'decline') {
                        icon = ' ❌'; // ไม่รับเคส
                    }
                    // Add IC phone if available
                    const nameWithIC = formatNameWithIC(name);
                    message += `• ${nameWithIC}${icon}\n`;
                });
            } else {
                message += '_ไม่มี_\n';
            }
            message += '────────────────────\n\n';

            // Off Duty List
            message += `❌ **Off Duty (${offDuty.length} คน):**\n`;
            if (offDuty.length > 0) {
                offDuty.slice(0, 20).forEach(m => {
                    const name = m.name || m;
                    message += `• ${name}\n`;
                });
                if (offDuty.length > 20) {
                    message += `_...และอีก ${offDuty.length - 20} คน_\n`;
                }
            } else {
                message += '_ไม่มี_\n';
            }
            message += '────────────────────\n\n';

            // AFK List
            if (afkList.length > 0) {
                message += `💤 **AFK (${afkList.length} คน):**\n`;
                afkList.forEach(name => {
                    const afkTime = data.afkTimes?.[name];
                    let timeStr = '';
                    if (afkTime) {
                        const mins = Math.floor((Date.now() - afkTime) / 60000);
                        timeStr = ` (${mins} นาที)`;
                    }
                    message += `• ${name}${timeStr}\n`;
                });
                message += '────────────────────\n\n';
            }

            // Stories (cases) - show in OP Channel during active shift
            const allStories = data.cases || [];
            const stories = filterTodayItems(allStories);
            message += `⚔️ **สตอรี่ (${stories.length} เคส):**\n`;
            if (stories.length > 0) {
                stories.forEach((c, i) => {
                    const partyA = c.partyA || '?';
                    const partyB = c.partyB || '?';
                    const location = c.location || '';
                    const startTime = c.startTime || '';
                    const medics = c.medics || [];
                    const mainMedic = medics[0] ? formatWithMention(medics[0]) : 'ยังไม่มี';
                    const supportMedics = medics.slice(1).map(m => formatWithMention(m)).join(', ');
                    const isClosed = c.closed;

                    // Add "✅ Clear" for closed stories
                    const statusLabel = isClosed ? ' ✅ **Clear**' : '';

                    message += `**สตอรี่ #${i + 1}**${statusLabel} ${startTime ? `⏰ ${startTime}` : ''}\n`;
                    message += `ระหว่าง ${partyA} VS ${partyB}\n`;
                    if (location) message += `📍 ${location}\n`;
                    message += `แพทย์ผู้รับผิดชอบ : ${mainMedic}\n`;
                    if (supportMedics) {
                        message += `แพทย์ช่วยเหลือ : ${supportMedics}\n`;
                    }
                    message += '\n';
                });
            } else {
                message += '_ไม่มีสตอรี่ในขณะนี้_\n';
            }

            // Events (activeEvents) - show all current events (they expire automatically)
            const activeEvents = data.activeEvents || [];
            if (activeEvents.length > 0) {
                message += '────────────────────\n';
                message += `🎉 **Events (${activeEvents.length}):**\n`;
                activeEvents.forEach(e => {
                    const emoji = e.emoji || '🎉';
                    const eventName = e.name || 'Event';
                    const participants = (e.medics || []).join(', ') || 'ยังไม่มี';
                    message += `**${emoji} ${eventName}**\n`;
                    message += `ผู้เข้าร่วม: ${participants}\n\n`;
                });
            }
        } // End of else block

        // Get stored message ID for OP channel
        const configDoc = await db.collection('config').doc('discord_message').get();
        const storedMessageId = configDoc.exists ? configDoc.data().opChannelMessageId : null;

        // When shift ends (no OP), ALWAYS send a NEW message
        // This ensures "รอ OP เปิดกะ" is a fresh message after the summary
        if (currentOP === 'ไม่มี') {
            const newMsg = await channel.send(message);
            await db.collection('config').doc('discord_message').set({
                opChannelMessageId: newMsg.id
            }, { merge: true });
            console.log('✅ OP Channel: New "waiting" message sent (shift ended)');
        } else if (storedMessageId) {
            try {
                const msg = await channel.messages.fetch(storedMessageId);
                await msg.edit(message);
                console.log('✅ OP Channel message edited');
            } catch (e) {
                const newMsg = await channel.send(message);
                await db.collection('config').doc('discord_message').set({
                    ...configDoc.data(),
                    opChannelMessageId: newMsg.id
                }, { merge: true });
                console.log('✅ OP Channel new message sent');
            }
        } else {
            const newMsg = await channel.send(message);
            await db.collection('config').doc('discord_message').set({
                opChannelMessageId: newMsg.id
            }, { merge: true });
            console.log('✅ OP Channel initial message sent');
        }
    } catch (error) {
        console.error('❌ updateOPChannelMessage error:', error);
    }
}

// --- Update Story Channel Message ---
// Shows stories for the day, marks closed ones with "Clear"
// Edits existing message while stories are still open
// Posts NEW message when ALL stories in current batch are closed
// Uses summarizedStoryIds to track which stories have been finalized
async function updateStoryChannelMessage(data) {
    try {
        const channel = await client.channels.fetch(STORY_CHANNEL_ID);
        if (!channel) {
            console.error('❌ Story channel not found');
            return;
        }

        const allStories = data.cases || [];
        const todayStories = filterTodayItems(allStories);

        // Get config with summarized story IDs
        const configDoc = await db.collection('config').doc('discord_message').get();
        const configData = configDoc.exists ? configDoc.data() : {};
        const storedMessageId = configData.storyMessageId || null;
        let summarizedStoryIds = configData.summarizedStoryIds || [];
        const summarizedDate = configData.summarizedDate || null;

        // Get today's date string for comparison
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD format

        // Clear summarized IDs if it's a new day
        if (summarizedDate && summarizedDate !== todayStr) {
            summarizedStoryIds = [];
            console.log('🔄 New day detected - cleared summarizedStoryIds');
        }

        // Filter out already-summarized stories from the current batch
        const activeStories = todayStories.filter(s => !summarizedStoryIds.includes(s.id));

        // No active stories to display
        if (activeStories.length === 0) {
            console.log('📭 No active stories to display (all summarized or none)');
            return;
        }

        // Check if there are any OPEN (not closed) stories in active batch
        const openStories = activeStories.filter(s => !s.closed);
        const allClosed = openStories.length === 0;

        // Get date from first story's storyDate, or use current date as fallback
        let dateStr;
        if (activeStories.length > 0 && activeStories[0].storyDate) {
            const [year, month, day] = activeStories[0].storyDate.split('-').map(Number);
            const storyDateObj = new Date(year, month - 1, day);
            dateStr = storyDateObj.toLocaleDateString('th-TH', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        } else {
            dateStr = now.toLocaleDateString('th-TH', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        }

        // Build message - show active stories only
        let message = '';
        message += allClosed ? '**📋 สรุปเคสสตอรี่**\n' : '**📋 แจ้งเคสสตอรี่**\n';
        message += '────────────────────\n';
        message += `📅 ${dateStr}\n`;
        message += '────────────────────\n\n';

        // Show active stories with status
        message += `⚔️ **สตอรี่ (${activeStories.length} เคส):**\n`;
        activeStories.forEach((c, i) => {
            const partyA = c.partyA || '?';
            const partyB = c.partyB || '?';
            const location = c.location || '';
            const startTime = c.startTime || '';
            const medics = c.medics || [];
            const mainMedic = medics[0] ? formatWithMention(medics[0]) : 'ยังไม่มี';
            const supportMedics = medics.slice(1).map(m => formatWithMention(m)).join(', ');
            const isClosed = c.closed;

            // Add "✅ Clear" for closed stories
            const statusLabel = isClosed ? ' ✅ **Clear**' : '';

            message += `**สตอรี่ #${i + 1}**${statusLabel} ${startTime ? `⏰ ${startTime}` : ''}\n`;
            message += `ระหว่าง ${partyA} VS ${partyB}\n`;
            if (location) message += `📍 ${location}\n`;
            message += `แพทย์ผู้รับผิดชอบ : ${mainMedic}\n`;
            if (supportMedics) {
                message += `แพทย์ช่วยเหลือ : ${supportMedics}\n`;
            }
            message += '\n';
        });

        if (allClosed) {
            // ALL stories in current batch closed - update existing message to "สรุป"
            if (storedMessageId) {
                try {
                    const msg = await channel.messages.fetch(storedMessageId);
                    await msg.edit(message);
                    console.log('✅ Story Channel: All closed - edited existing message to summary');
                } catch (e) {
                    // Message not found - send new summary
                    await channel.send(message);
                    console.log('✅ Story Channel: All closed - sent new summary (old message not found)');
                }
            } else {
                // No existing message - send summary
                await channel.send(message);
                console.log('✅ Story Channel: All closed - sent new summary');
            }

            // Add current batch story IDs to summarized list
            const newSummarizedIds = [...summarizedStoryIds, ...activeStories.map(s => s.id)];

            // Clear storyMessageId and save summarized IDs so next batch starts a NEW message
            await db.collection('config').doc('discord_message').set({
                storyMessageId: null,
                summarizedStoryIds: newSummarizedIds,
                summarizedDate: todayStr
            }, { merge: true });
            console.log(`🔄 Cleared storyMessageId, saved ${activeStories.length} summarized story IDs`);
        } else if (storedMessageId) {
            // Still have open stories - try to EDIT existing message
            try {
                const msg = await channel.messages.fetch(storedMessageId);
                await msg.edit(message);
                console.log('✅ Story Channel message edited');
            } catch (e) {
                // Message not found - send new
                const newMsg = await channel.send(message);
                await db.collection('config').doc('discord_message').set({
                    ...configData,
                    storyMessageId: newMsg.id
                }, { merge: true });
                console.log('✅ Story Channel new message sent');
            }
        } else {
            // No existing message - send new
            const newMsg = await channel.send(message);
            await db.collection('config').doc('discord_message').set({
                ...configData,
                storyMessageId: newMsg.id
            }, { merge: true });
            console.log('✅ Story Channel initial message sent');
        }

    } catch (error) {
        console.error('❌ updateStoryChannelMessage error:', error);
    }
}

// --- Get All Members with Badges (API) ---
async function getAllMembersWithBadges() {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();

        return members.map(member => ({
            id: member.id,
            username: member.user.username,
            displayName: member.displayName,
            avatar: member.user.displayAvatarURL({ format: 'png', size: 128 }),
            badge: getUserBadge(member)
        }));
    } catch (error) {
        console.error('❌ getAllMembersWithBadges error:', error);
        return [];
    }
}

// --- Graceful Shutdown ---
process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down...');
    await logToFirestore('INFO', 'Bot shutting down (SIGTERM)');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, shutting down...');
    await logToFirestore('INFO', 'Bot shutting down (SIGINT)');
    client.destroy();
    process.exit(0);
});

// --- Start Bot ---
console.log('🚀 Starting Medical OP Discord Bot...');
client.login(DISCORD_TOKEN).catch((error) => {
    console.error('❌ Login failed:', error.message);
    process.exit(1);
});
