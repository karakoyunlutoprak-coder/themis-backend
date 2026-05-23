const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB bağlantısı
mongoose.connect('mongodb://localhost:27017/themis')
  .then(() => console.log('MongoDB bağlandı'))
  .catch(err => console.log('MongoDB hatası:', err));

// Kullanıcı şeması
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  userType: { type: String, enum: ['bireysel', 'buro'], required: true },
  buroCapacity: { type: Number, default: 0 },
  usageCount: { type: Number, default: 0 },
  plan: { type: String, default: 'free' },
  planExpiry: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Kayıt ol
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, userType } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu e-posta zaten kayıtlı' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    let buroCapacity = 0;
    if (userType === 'buro') {
      buroCapacity = 25;
    }
    
    const user = new User({
      email,
      password: hashedPassword,
      userType,
      buroCapacity
    });
    
    await user.save();
    res.json({ message: 'Kayıt başarılı' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Giriş yap
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Hatalı şifre' });
    }
    
    const token = jwt.sign({ userId: user._id }, 'gizli-anahtar', { expiresIn: '7d' });
    res.json({ token, user: { email: user.email, userType: user.userType } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Kullanıcı bilgilerini getir
app.get('/api/user', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token gerekli' });
    }
    
    const decoded = jwt.verify(token, 'gizli-anahtar');
    const user = await User.findById(decoded.userId).select('-password');
    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Geçersiz token' });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} adresinde çalışıyor`);
});