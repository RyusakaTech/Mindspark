require('dotenv').config(); // npm install dotenv
const express = require('express'); // npm install express
const mysql = require('mysql'); // npm install mysql
const path = require('path'); // Já faz parte do Node.js, não é necessário instalar
const multer = require('multer'); // npm install multer
const nodemailer = require('nodemailer'); // npm install nodemailer
const bcrypt = require('bcrypt'); // npm install bcrypt
const { body, validationResult } = require('express-validator'); // npm install express-validator
const session = require('express-session'); // npm install express-session

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public')); // Servir arquivos estáticos da pasta 'public'

// Configuração do gerenciamento de sessões
app.use(session({
    secret: 'abcd', // Substitua por uma chave segura
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Em produção, use "true" com HTTPS
}));

// Configuração do MySQL
const db = mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'admin@2024',
    database: 'mindspark'
});

// Conectar ao MySQL
db.connect((err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err);
        return;
    }
    console.log('Conectado ao banco de dados MySQL');
});

// Configuração do Multer para upload de fotos
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'mindspark4410@gmail.com',
        pass: 'hzajqrshyjwdzvko' // App Password do Gmail
    }
});

transporter.verify((error, success) => {
    if (error) {
        console.error('Erro de conexão SMTP:', error);
    } else {
        console.log('SMTP está pronto para enviar mensagens');
    }
});

// Middleware para verificar se o usuário está logado
function verificaLogin(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login.html');
    }
}

app.post('/cadastro', [
    body('email').isEmail().withMessage('Email inválido'),
    body('senha').isLength({ min: 6 }).withMessage('A senha deve ter pelo menos 6 caracteres')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { nome, sobrenome, data_nasci, escolaridade, email, senha } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(senha, 10);

        const query = `
            INSERT INTO login (nome, sobrenome, data_nasci, escolaridade, email, senha)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const values = [nome, sobrenome, data_nasci, escolaridade, email, hashedPassword];

        db.query(query, values, (err) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Email já cadastrado!' });
                }                
                return res.status(500).json({ error: 'Erro ao cadastrar usuário.' });
            }
            res.json({ message: 'Usuário cadastrado com sucesso!', redirect: '/login.html' });
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao processar o cadastro.' });
    }
});

// Rotas para páginas estáticas
app.get('/entrar', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/suporte', (req, res) => res.sendFile(path.join(__dirname, 'public/suporte.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/ticket', (req, res) => res.sendFile(path.join(__dirname, 'public/ticket.html')));
app.get('/cadastro', (req, res) => res.sendFile(path.join(__dirname, 'public/cadastro.html')));

// Rota protegida - Cursos
app.get('/curso', verificaLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/curso.html'));
});

// Rota de autenticação
app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const sql = 'SELECT * FROM login WHERE email = ?';

    db.query(sql, [email], async (err, results) => {
        if (err) {
            console.error('Erro na consulta ao banco de dados:', err);
            return res.status(500).json({ message: 'Erro interno no servidor' });
        }
        if (results.length > 0) {
            const user = results[0];
            const isPasswordValid = await bcrypt.compare(password, user.senha);
            if (isPasswordValid) {
                req.session.user = { id: user.id, nome: user.nome };
                return res.json({
                    message: 'Login bem-sucedido',
                    redirect: '/index.html',
                    name: user.nome
                });
            }
        }
        res.status(401).json({ message: 'Email ou senha incorretos' });
    });
});

// Rota de logout
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Erro ao encerrar sessão:', err);
            return res.status(500).json({ message: 'Erro ao fazer logout' });
        }
        res.json({ message: 'Logout bem-sucedido', redirect: '/login.html' });
    });
});

// Rota para verificar se o usuário está logado e retornar o nome
app.get('/api/user', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, name: req.session.user.nome });
    } else {
        res.json({ loggedIn: false });
    }
});

// Rota POST para enviar o ticket
app.post('/enviar-ticket', upload.single('photo'), (req, res) => {
    const { name, email, celular, role, duvida } = req.body;
    const photo = req.file;

    // Busca o e-mail do professor com base no 'role' (que é o ID do professor)
    db.query('SELECT email FROM professores WHERE id = ?', [role], (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Erro interno do servidor ao buscar professor.' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Professor não encontrado.' });
        }

        const professorEmail = results[0].email;

        // Opções para o envio do e-mail
        const mailOptions = {
            from: 'mindspark4410@gmail.com',
            to: professorEmail,
            subject: `Dúvida de ${name}`,
            text: `Aluno: ${name}
Email: ${email}
Celular: ${celular}

Dúvida: ${duvida}

NÃO RESPONDA ESTE E-MAIL, USE O E-MAIL QUE FOI FORNECIDO PELO ALUNO PARA RESPONDÊ-LO`,
            attachments: photo ? [{ path: photo.path }] : [] // Verifica se existe foto e anexa, caso sim
        };

        // Envia o e-mail
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                return res.status(500).json({ message: 'Erro ao enviar o ticket.' });
            }
            res.json({ message: 'Ticket enviado com sucesso!' });
        });
    });
});


// Rota POST para enviar o suporte
app.post('/enviar-suporte', upload.single('photo'), (req, res) => {
    const { name, email, celular, problema, vce } = req.body;
    const photo = req.file;

    // Opções para o envio do e-mail
    const mailOptions = {
        from: 'mindspark4410@gmail.com',
        to: 'kevin.lemos2054@gmail.com', // Alterar para o e-mail de destino adequado
        subject: `Suporte solicitado por ${name}`,
        text: `Nome: ${name}\nEmail: ${email}\nCelular: ${celular}\nProblema: ${problema}\nPerfil: ${vce}`,
        attachments: photo ? [{ path: photo.path }] : [] // Verifica se existe foto e anexa, caso sim
    };

    // Envia o e-mail
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return res.status(500).json({ message: 'Erro ao enviar a mensagem de suporte.' });
        }
        res.json({ message: 'Mensagem de suporte enviada com sucesso!' });
    });
});

// Rota GET para listar os professores
app.get('/professores', (req, res) => {
    db.query('SELECT id, nome FROM professores', (err, results) => {
        if (err) return res.status(500).json({ message: 'Erro ao buscar professores.' });
        res.json(results);
    });
});

app.get('/video/:id', (req, res) => {
    const videoId = req.params.id; // ID do vídeo passado na URL
    const query = 'SELECT link FROM video WHERE id = ?'; // Substitua "videos" pelo nome correto da sua tabela

    db.query(query, [videoId], (err, results) => {
        if (err) {
            console.error('Erro ao buscar link do vídeo:', err);
            return res.status(500).send('Erro no servidor');
        }

        if (results.length === 0) {
            return res.status(404).send('Vídeo não encontrado');
        }

        res.json({ link: results[0].link });
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});