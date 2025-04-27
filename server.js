import express from "express";
import dotenv from "dotenv";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import cors from "cors";
const { Pool } = pg;
const app = express();

dotenv.config();

app.use(cookieParser());
// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cors({ credentials: true, origin: "http://127.0.0.1:5500"}));
const salt = 10;
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

await pool.connect();
console.log("database connected");

app.get("/", (req,res) => {
    res.send("API is running...");
})

// authentication
const authenticateToken = async (req,res,next) =>{
    const token = await req.cookies.token;
    if(!token) {
        return res.status(401).send("Access denided");
    }
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    }catch (error) {
        console.error("Error verifying token", error.stack);
        res.status(400).send("Invalid token");
    }
};

// get all users
app.get("/api/users",authenticateToken, async (req, res) => {
    await pool.query("SELECT * FROM users", (error, results) => {
        if(error) {
            throw error;
        }
        res.status(200).json(results.rows)
    });
});

// register route
app.post('/api/users/register', async (req,res) => {
    const user = req.body;
    console.log(req.body)
    const {username,email, password } = user;
    try {
        const userExists = await pool.query(
            `SELECT * FROM users WHERE email = '${email}';`
        );
        if (userExists.rows.length > 0){
            return res.send("user already exists");

        }

        const hash = await bcrypt.hash(password, salt);
        const userData = {
            username,
            email,
            password: hash,
        }

        await pool.query(
            `INSERT INTO users (username,email, password) VALUES ('${userData.username}','${userData.email}','${userData.password}')`
        );
        res.send("user added")
    }catch (error) {
        console.log("error executing query", error.stack);
        res.send("error adding user");
    }
});

// login route 
app.post('/api/users/login', async(req,res) => {
    console.log("user logged in");
    const user = req.body;
    const {email, password} = user;
    try {
        const userData = await pool.query(
            `SELECT * FROM users WHERE email = '${email}';`
        );
        console.log("user logged in ",userData.rows[0]);
        const match = await bcrypt.compare(password, userData.rows[0].password);
        if(!match) {
            return res.status(400).send("Invalid password");

        }
        const token = jwt.sign({ email: userData.rows[0].email }, process.env.JWT_SECRET, {expiresIn: "1h"});
        res.cookie("token", token, {
            maxAge: 3600000,
            secure: true,
            httpOnly: true,
            sameSite: "None",
        });
        res.status(200).json({message: "user logged in"});

    }catch (error) {
        console.error("error executing query", error.stack);
        res.send("error logging in user")
    }
})

app.get('/api/users/logout', async (req,res) => {
    res.clearCookie("token");
    res.send("user logged out")
})


//dashboard
//get accountById
app.get('/api/users/:id',authenticateToken, async(req,res) =>{
    const id = req.params.id;
    console.log(id)
    try {
        const result = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [id]);
        if(result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found'});
        }
        res.json(result.rows[0]);
    } catch(error) {
        console.error(error.stack)
        res.status(500).json({error: error.message});
    }
})
// get notes by userid
app.get('/api/users/:userId/notes',authenticateToken, async (req,res) => {
    console.log('query notes');
    const userId = req.params.userId;

    try {
        const noteData = await pool.query(
            `SELECT * FROM notes WHERE user_id = $1`, [userId]
        );
        res.json(noteData.rows)
    }catch(error) {
        console.error("error executing query", error.stack);
        res.status(500).json({ error: error.message });
    }
});
//create notes
app.post('/api/users/:userId/notes',authenticateToken,async(req,res) => {
    const {userId} = req.params;
    // console.log(req.params)
    const {title, content } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO notes (user_id,title,content) VALUES ($1, $2, $3) RETURNING *`,[userId,title,content]
        );
        res.status(201).json(result.rows[0]);

    }catch (error){
        console.error(error.stack);
        res.status(500).json({error: error.message})
    }
})

//update notes
app.put('/api/user/:userId/notes/:noteId',authenticateToken, async(req,res) => {
    const {userId,noteId} = req.params;
    const {title, content} = req.body;
    try {
        const result = await pool.query(
            `UPDATE notes 
            SET title = $1, content = $2 
            WHERE user_id = $3 AND id = $4 
            RETURNING *`,[title,content,userId,noteId]

        )
        res.json(result.rows[0]);

    }catch (error) {
        console.error(error.stack)
        res.status(500).json({error: error.message});
    }
})

//delete notes
app.delete('/api/user/:userId/notes/:noteId',authenticateToken, async(req,res) =>{
    const {userId, noteId} = req.params;
    try {
        const result = await pool.query(
            `DELETE FROM notes
            WHERE id = $1
            RETURNING *`,[noteId]
        )
        res.json({message: 'Note deleted'});
    }catch (error) {
        res.status(500).json({error: error.message})
    }
})
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
