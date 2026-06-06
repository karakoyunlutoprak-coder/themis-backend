const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB bağlantısı - ORTAM DEĞİŞKENİNİ KULLAN
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI ortam değişkeni tanımlanmamış!');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB bağlandı'))
  .catch(err => console.error('❌ MongoDB bağlantı hatası:', err));

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

// ========== API ROTALARI ==========

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, userType } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Bu e-posta zaten kayıtlı' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    let buroCapacity = 0;
    if (userType === 'buro') buroCapacity = 25;
    
    const user = new User({ email, password: hashedPassword, userType, buroCapacity });
    await user.save();
    res.json({ message: 'Kayıt başarılı' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Kullanıcı bulunamadı' });
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Hatalı şifre' });
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'gizli-anahtar', { expiresIn: '7d' });
    res.json({ token, user: { email: user.email, userType: user.userType } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/user', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token gerekli' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli-anahtar');
    const user = await User.findById(decoded.userId).select('-password');
    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Geçersiz token' });
  }
});

app.post('/api/check-usage', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token gerekli' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli-anahtar');
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    
    let canUse = false;
    let message = '';
    if (user.plan === 'free') {
      if (user.usageCount < 1) {
        canUse = true;
        message = '1 ücretsiz kullanım hakkınız kaldı.';
      } else {
        canUse = false;
        message = 'Ücretsiz kullanım hakkınız doldu. Lütfen plan satın alın.';
      }
    } else {
      if (user.planExpiry && new Date() > user.planExpiry) {
        canUse = false;
        message = 'Plan süreniz doldu. Yenileyin.';
        user.plan = 'free';
        await user.save();
      } else {
        canUse = true;
        message = 'Planınız aktif.';
      }
    }
    res.json({ canUse, message, usageCount: user.usageCount, plan: user.plan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/increment-usage', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token gerekli' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli-anahtar');
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    user.usageCount += 1;
    await user.save();
    res.json({ message: 'Kullanım sayısı güncellendi', usageCount: user.usageCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/buy-plan', async (req, res) => {
  try {
    const { planType } = req.body;
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token gerekli' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli-anahtar');
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    
    let expiryDate = new Date();
    if (planType === 'aylik') {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
      user.plan = 'aylik';
    } else if (planType === '6aylik') {
      expiryDate.setMonth(expiryDate.getMonth() + 6);
      user.plan = '6aylik';
    } else if (planType === 'buro') {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
      user.plan = 'aylik';
      user.buroCapacity = 25;
    } else {
      return res.status(400).json({ error: 'Geçersiz plan tipi' });
    }
    user.planExpiry = expiryDate;
    user.usageCount = 0;
    await user.save();
    res.json({ message: 'Plan satın alındı (simülasyon)', plan: user.plan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/analyze-file', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token gerekli' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli-anahtar');
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    
    if (user.plan === 'free' && user.usageCount >= 1) {
      return res.status(403).json({ error: 'Kullanım hakkınız kalmadı. Plan satın alın.' });
    }
    
    const { fileContent, fileName } = req.body;
    if (!fileContent) return res.status(400).json({ error: 'Dosya içeriği gerekli' });
    
    const summary = fileContent.length > 200 ? fileContent.substring(0, 200) + '...' : fileContent;
    const analysis = `Dosya: ${fileName}\nÖzet: ${summary}\nKelime sayısı: ${fileContent.split(/\s+/).length}\nBu bir simülasyon analizdir. Gerçek AI için API eklenecek.`;
    
    user.usageCount += 1;
    await user.save();
    res.json({ analysis, usageCount: user.usageCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mesajlar
const messageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  chatId: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

app.post('/api/messages', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token gerekli' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli-anahtar');
    const { chatId, role, content } = req.body;
    const message = new Message({ userId: decoded.userId, chatId, role, content });
    await message.save();
    res.json({ message: 'Kaydedildi' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/messages/:chatId', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token gerekli' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli-anahtar');
    const messages = await Message.find({ userId: decoded.userId, chatId: req.params.chatId }).sort('createdAt');
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chats', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token gerekli' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gizli-anahtar');
    const chats = await Message.aggregate([
      { $match: { userId: decoded.userId } },
      { $group: { _id: '$chatId', lastMessage: { $last: '$content' }, updatedAt: { $max: '$createdAt' } } },
      { $sort: { updatedAt: -1 } }
    ]);
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server http://localhost:${PORT} adresinde çalışıyor`);
});
