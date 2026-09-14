# RealTime Chat API

Production-grade Real-time Chat Application API built with Node.js, Express, Socket.io, MongoDB, and Redis.

## 🚀 Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js 4
- **Real-time:** Socket.io 4
- **Database:** MongoDB 7 + Mongoose 7
- **Cache/Pub-Sub:** Redis 7 (ioredis)
- **Auth:** JWT (access + refresh) + bcrypt
- **Validation:** Joi
- **Logging:** Winston + daily rotation
- **Uploads:** Multer + Cloudinary (or local)
- **Testing:** Jest + Supertest + mongodb-memory-server

## 📁 Project Structure

(see folder tree in source)

## ⚙️ Setup

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Redis (optional but recommended)

### Installation

```bash
git clone <repo-url>
cd realtime-chat-api
npm install
cp .env.example .env
# edit .env with your values
npm run dev