# Medical OP Discord Bot

Discord Bot สำหรับ Medical OP Systems - รันบน Railway 24/7

## Features

- 📊 Real-time Story Updates → ส่ง/Edit ข้อความใน Discord
- 👥 Role Detection → แสดง Badge ตามยศ
- 📩 OP Channel Monitoring → อ่านข้อความจากห้อง OP
- 🔗 Firebase Integration → Sync กับ Web App

## Setup Railway

1. **สร้าง New Project ที่ Railway.app**

2. **Deploy from GitHub:**
   - เลือก Repository
   - ชี้ไปที่โฟลเดอร์ `discord-bot`

3. **ตั้งค่า Environment Variables:**
   ```
   DISCORD_TOKEN=your_token_here
   GUILD_ID=1449713402758037586
   OP_CHANNEL_ID=1449713444789026827
   STORY_CHANNEL_ID=1449713444789026827
   ROLE_SSS_PLUS_ID=1449716490256515133
   ROLE_SSS_ID=1449716311318986763
   ROLE_SS_ID=1449716180779663521
   ROLE_A_ID=1449715869390209189
   ROLE_B_ID=1449715729308848189
   ROLE_C_ID=1449715677173649469
   ROLE_D_ID=1449715264840011867
   FIREBASE_SERVICE_ACCOUNT_BASE64=...
   ```

4. **สร้าง Firebase Service Account:**
   - ไป Firebase Console → Project Settings → Service Accounts
   - Generate New Private Key → Download JSON
   - Encode เป็น Base64: `base64 -w 0 service-account.json`
   - ใส่ใน `FIREBASE_SERVICE_ACCOUNT_BASE64`

## Local Development

```bash
npm install
# Copy .env.example to .env and fill values
npm start
```
