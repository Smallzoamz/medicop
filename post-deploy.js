// post-deploy.js - Run after firebase deploy to trigger Force Refresh for all users
const admin = require('firebase-admin');

// Initialize Firebase Admin (uses default credentials from firebase login)
const serviceAccount = require('./service-account-key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://medic-op.firebaseio.com"
});

const db = admin.firestore();

// Get version from command line argument or package.json
const newVersion = process.argv[2] || '1.3.6';

async function updateVersion() {
    try {
        console.log(`🔄 Updating Firebase appVersion to: ${newVersion}`);

        await db.collection('settings').doc('appVersion').set({
            version: newVersion,
            updatedAt: Date.now(),
            updatedBy: 'System (Post-Deploy Script)'
        });

        console.log('✅ Firebase version updated!');
        console.log('🔔 All users with the page open will now see Force Refresh popup.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error updating version:', error);
        process.exit(1);
    }
}

updateVersion();
