const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const app = express();

// Middleware to allow frontend to talk to backend
app.use(cors());
app.use(express.json());

// Serve your frontend (index.html)
app.use(express.static(path.join(__dirname, '.')));

// Set up file upload
const upload = multer({ dest: 'uploads/' });

// Connect to SQLite database
const db = new sqlite3.Database('attendance.db', (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database');
        // Create tables
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                phone TEXT,
                email TEXT UNIQUE,
                password TEXT,
                institutionType TEXT,
                school TEXT,
                class TEXT,
                section TEXT,
                college TEXT,
                year TEXT,
                branch TEXT,
                role TEXT
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                userId INTEGER,
                rollNumber TEXT,
                name TEXT,
                FOREIGN KEY (userId) REFERENCES users(id)
            )
        `);
        db.run(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                studentId INTEGER,
                date TEXT,
                status TEXT,
                FOREIGN KEY (studentId) REFERENCES students(id)
            )
        `);
    }
});

// Register a user
app.post('/register', (req, res) => {
    const { name, phone, email, password, institutionType, school, class: className, section, college, year, branch, role } = req.body;
    
    // First, check if the email already exists
    db.get('SELECT email FROM users WHERE email = ?', [email], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (row) {
            // If email exists, send an error message
            return res.status(400).json({ error: 'This email is already registered. Please use a different email.' });
        }
        
        // If email doesn't exist, proceed with registration
        const query = `
            INSERT INTO users (name, phone, email, password, institutionType, school, class, section, college, year, branch, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(query, [name, phone, email, password, institutionType, school, className, section, college, year, branch, role], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Failed to register user' });
            }
            res.json({ id: this.lastID });
        });
    });
});

// Login a user
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.get('SELECT * FROM users WHERE email = ? AND password = ?', [email, password], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        res.json({ userId: user.id, institutionType: user.institutionType });
    });
});

// Reset password
app.post('/reset-password', (req, res) => {
    const { emailOrPhone, newPassword } = req.body;
    db.run('UPDATE users SET password = ? WHERE email = ? OR phone = ?', [newPassword, emailOrPhone, emailOrPhone], function(err) {
        if (err || this.changes === 0) {
            return res.status(400).json({ error: 'Email or phone not found' });
        }
        res.json({ message: 'Password reset successful' });
    });
});

app.post('/upload-students', upload.single('file'), async (req, res) => {
    const XLSX = require('xlsx');
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    const students = data.map(row => ({ name: row.Name }));
    res.json(students);
});

// Save students
app.post('/save-students', (req, res) => {
    const { userId, students, startRoll } = req.body;
    const queries = students.map((student, index) => {
        const rollNumber = `${startRoll.slice(0, -String(index + 1).length)}${(parseInt(startRoll.match(/\d+$/)[0]) + index).toString().padStart(String(index + 1).length, '0')}`;
        return new Promise((resolve, reject) => {
            db.run('INSERT INTO students (userId, rollNumber, name) VALUES (?, ?, ?)', [userId, rollNumber, student.name], function(err) {
                if (err) reject(err);
                resolve(this.lastID);
            });
        });
    });
    Promise.all(queries)
        .then(() => res.json({ message: 'Students saved' }))
        .catch(err => {
            console.error(err);
            res.status(500).json({ error: 'Failed to save students' });
        });
});

// Save attendance
app.post('/save-attendance', (req, res) => {
    const { date, attendance, userId } = req.body;
    if (!date || !attendance || !userId) {
        return res.status(400).json({ error: 'Missing required fields: date, attendance, or userId' });
    }
    const queries = attendance.map(record => {
        return new Promise((resolve, reject) => {
            db.get('SELECT id FROM students WHERE rollNumber = ? AND userId = ?', [record.roll, userId], (err, student) => {
                if (err) {
                    console.error('Database error while finding student:', err);
                    return reject(new Error('Database error while finding student'));
                }
                if (!student) {
                    console.error(`Student with rollNumber ${record.roll} not found for userId ${userId}`);
                    return reject(new Error(`Student with roll number ${record.roll} not found`));
                }
                db.run('INSERT INTO attendance (studentId, date, status) VALUES (?, ?, ?)', [student.id, date, record.status], function(err) {
                    if (err) {
                        console.error('Database error while saving attendance:', err);
                        return reject(new Error('Failed to save attendance record'));
                    }
                    resolve();
                });
            });
        });
    });
    Promise.all(queries)
        .then(() => res.json({ message: 'Attendance saved' }))
        .catch(err => {
            console.error('Error saving attendance:', err.message);
            res.status(500).json({ error: err.message });
        });
});

// Get user profile
app.get('/profile/:userId', (req, res) => {
    const { userId } = req.params;
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    });
});

// Update profile
app.put('/profile/:userId', (req, res) => {
    const { userId } = req.params;
    const { name, phone, school, class: className, section, college, year, branch, role } = req.body;
    const query = `
        UPDATE users SET name = ?, phone = ?, school = ?, class = ?, section = ?, college = ?, year = ?, branch = ?, role = ?
        WHERE id = ?
    `;
    db.run(query, [name, phone, school, className, section, college, year, branch, role, userId], function(err) {
        if (err || this.changes === 0) {
            return res.status(400).json({ error: 'Failed to update profile' });
        }
        res.json({ message: 'Profile updated' });
    });
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, '192.168.55.103', () => {
    console.log(`Server running on port ${port}`);
});