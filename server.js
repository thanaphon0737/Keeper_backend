import express from "express";
import dotenv from "dotenv";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "path";
import fs from "fs";
import { error } from "console";

const { Pool } = pg;
const app = express();

dotenv.config();

app.use(cookieParser());
// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

//allow public directory
app.use("/uploads", express.static("uploads"));
// Middleware to parse JSON bodies
app.use(express.json());
app.use(cors({ credentials: true, origin: "http://localhost:5173" }));
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

app.get("/", (req, res) => {
  res.send("API is running...");
});

// rate limitaion for api
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many request, try again later.",
});
app.use(limiter);

//setup upload files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });
// authentication
const authenticateToken = async (req, res, next) => {
  const token = await req.cookies.token;
  if (!token) {
    return res.status(401).send("Access denided");
  }
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    console.error("Error verifying token", error.stack);
    res.status(400).send("Invalid token");
  }
};

// get all users
app.get("/api/users", authenticateToken, async (req, res) => {
  await pool.query("SELECT * FROM users", (error, results) => {
    if (error) {
      throw error;
    }
    res.status(200).json(results.rows);
  });
});

// register route
app.post("/api/users/register", async (req, res) => {
  const user = req.body;
  console.log(req.body);
  const { username, email, password } = user;
  try {
    if (username !== "" || email !== "" || password !== "") {
      const userExists = await pool.query(
        `SELECT * FROM users WHERE email = '${email}';`
      );
      if (userExists.rows.length > 0) {
        return res.status(400).send("user already exists");
      }

      const hash = await bcrypt.hash(password, salt);
      const userData = {
        username,
        email,
        password: hash,
      };

      await pool.query(
        `INSERT INTO users (username,email, password) VALUES ('${userData.username}','${userData.email}','${userData.password}')`
      );
      res.status(200).send("user added");
    }
  } catch (error) {
    console.log("error executing query", error.stack);
    res.status(400).send("error adding user");
  }
});

// login route
app.post("/api/users/login", async (req, res) => {
  const user = req.body;
  const { email, password } = user;
  try {
    const userData = await pool.query(
      `SELECT * FROM users WHERE email = '${email}';`
    );
    // console.log("user logged in ", userData.rows[0]);
    // console.log(userData)
    if (userData.rows.length !== 0) {
      console.log("user logged in");
      console.log(userData);
      const match = await bcrypt.compare(password, userData.rows[0].password);

      if (!match) {
        return res.status(400).send("Invalid password");
      }
      const token = jwt.sign(
        { email: userData.rows[0].email, userId: userData.rows[0].id },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );
      res.cookie("token", token, {
        maxAge: 3600000,
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
      });
      res.status(200).json({
        userId: userData.rows[0].id,
        userEmail: userData.rows[0].email,
      });
    } else {
      res.status(400).send("not register");
    }
    // res.json({message: "user logged in"});
  } catch (error) {
    console.error("error executing query", error.stack);
    res.send("error logging in user");
  }
});

app.get("/api/users/logout", async (req, res) => {
  res.clearCookie("token", {
    httpOnly: true, // Ensures it's only accessible by the server
    secure: true, // Use secure cookies in production (HTTPS)
    sameSite: "Strict", // Prevents cross-site request forgery
    path: "/", // Ensure the cookie is cleared for the root path
  });
  res.send("user logged out");
});

//dashboard
//get accountById
app.get("/api/users/:id", authenticateToken, async (req, res) => {
  const id = req.params.id;
  console.log(req.user);
  try {
    if (id === req.user.userId) {
      const result = await pool.query(
        "SELECT id, username, email FROM users WHERE id = $1",
        [id]
      );
      res.json(result.rows[0]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Account not found" });
      }
    } else {
      res.status(401).json({ error: "Unauthorize account" });
    }
  } catch (error) {
    console.error(error.stack);
    res.status(500).json({ error: error.message });
  }
});
// get notes by userid
app.get("/api/users/:userId/notes", authenticateToken, async (req, res) => {
  console.log("query notes");
  const userId = req.params.userId;

  const { q, tag, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  if (req.user.userId !== userId) {
    return res.status(403).json({
      error: "Forbidden",
    });
  }
  let values = [userId];
  let where = [`notes.user_id = $1`];
  let join = "";
  // search by title or content
  if (q) {
    values.push(`%${q}%`);
    where.push(
      `(notes.title ILIKE $${values.length} OR notes.content ILIKE $${values.length})`
    );
  }
  if (tag) {
    join = `
    LEFT JOIN note_tags ON notes.id = note_tags.note_id
    LEFT JOIN tags ON tags.id = note_tags.tag_id
    `;
    values.push(tag);
    where.push(`tags.name = $${values.length}`);
  }
  values.push(limit);
  values.push(offset);
  const query = `
    SELECT DISTINCT notes.* 
    FROM notes
    ${join}
    WHERE ${where.join(" AND ")}
    ORDER BY notes.created_at DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `;
  try {
    const noteData = await pool.query(query, values);
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM notes WHERE deleted = false"
    );
    const total = parseInt(countResult.rows[0].count);

    console.log(total);
    res.json({
      page,
      totalPages: Math.ceil(total / limit),
      notes: noteData.rows,
    });
  } catch (error) {
    console.error("error executing query", error.stack);
    res.status(500).json({ error: error.message });
  }
});
//get tags by userId
app.get("/api/users/:userId/tags", authenticateToken, async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT tags.name
      FROM notes 
      JOIN note_tags ON notes.id = note_tags.note_id 
      JOIN tags ON tags.id = note_tags.tag_id
      WHERE notes.user_id = $1
      `, [userId]
    );
    res.status(200).json({
      userId: userId,
      totalTags: result.rowCount,
      tags: result.rows
    })
  } catch (error) {
    res.status(500).json({error: error.message})
  }
});
// get tags
app.get("/api/notes/tags", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tags");
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// create tags
app.post("/api/users/:userId/tags", authenticateToken, async (req, res) => {
  const { userId } = req.params;
  const { name } = req.body;
  if (req.user.userId !== userId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (name === null) {
    return res.status(400).json({ error: "name is empty" });
  }
  try {
    const result = await pool.query(
      "INSERT INTO tags (name) VALUES ($1) RETURNING * ",
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// create relation tag and note
app.post(
  "/api/users/:userId/notes/:noteId",
  authenticateToken,
  async (req, res) => {
    const { userId, noteId } = req.params;
    const { tagId } = req.body;
    if (req.user.userId !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (tagId === null) {
      return res.status(400).json({ error: "tagId is required" });
    }
    try {
      const result = await pool.query(
        "INSERT INTO note_tags (tag_id,note_id) VALUES ($1,$2) RETURNING *",
        [tagId, noteId]
      );
      return res.status(201).json(result.rows);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
);
//create notes
app.post(
  "/api/users/:userId/notes",
  upload.single("file"),
  authenticateToken,
  async (req, res) => {
    const { userId } = req.params;
    // console.log(req.params)
    const { title, content } = req.body;

    const filePath = req.file ? req.file.path : null;

    if (title !== null || content !== null) {
      if (title === null) {
        res.status(400).json({ error: "title is empty" });
      } else if (content === null) {
        res.status(400).json({ error: "content is empty" });
      } else {
        if (req.user.userId === userId) {
          try {
            const result = await pool.query(
              `INSERT INTO notes (user_id,title,content,file) VALUES ($1, $2, $3,$4) RETURNING *`,
              [userId, title, content, filePath]
            );
            res.status(201).json(result.rows[0]);
          } catch (error) {
            console.error(error.stack);
            res.status(500).json({ error: error.message });
          }
        } else {
          res.status(401).json({ error: "Unauthorize account" });
        }
      }
    } else {
      res.status(400).json({ error: "filed is empty" });
    }
  }
);

//update notes
app.put(
  "/api/users/:userId/notes/:noteId",
  upload.single("file"),
  authenticateToken,
  async (req, res) => {
    const { userId, noteId } = req.params;
    const { title, content } = req.body;
    const filePath = req.file ? req.file.path : null;
    if (title !== null || content !== null) {
      if (title === null) {
        res.status(400).json({ error: "title is empty" });
      } else if (content === null) {
        res.status(400).json({ error: "content is empty" });
      } else {
        if (req.user.userId === userId) {
          try {
            const oldfile = await pool.query(
              "SELECT file FROM notes WHERE id = $1",
              [noteId]
            );
            const oldfilePath = oldfile.rows[0].file;
            console.log("path", oldfilePath);
            if (oldfilePath.rowCount === 0) {
              return res.status(404).json({ message: "Note not found" });
            }

            if (req.file) {
              if (fs.existsSync(oldfilePath)) {
                fs.unlinkSync(oldfilePath);
              }
            }
            const result = await pool.query(
              `UPDATE notes 
            SET title = $1, content = $2, file = $5
            WHERE user_id = $3 AND id = $4 
            RETURNING *`,
              [title, content, userId, noteId, filePath]
            );
            // console.log(result)
            res.json(result.rows[0]);
          } catch (error) {
            // console.error(error.stack);
            res.status(500).json({ error: error.message });
          }
        } else {
          res.status(401).json({ error: "Unauthorize account" });
        }
      }
    } else {
      res.status(400).json({ error: "filed is empty" });
    }
  }
);

//delete notes
app.delete(
  "/api/users/:userId/notes/:noteId",
  authenticateToken,
  async (req, res) => {
    const { userId, noteId } = req.params;
    if (req.user.userId === userId) {
      try {
        const checkId = await pool.query("SELECT id FROM notes WHERE id =$1", [
          noteId,
        ]);
        if (checkId.rowCount === 0) {
          return res.status(404).json({ message: "Note not found." });
        }
        const file = await pool.query("SELECT file FROM notes WHERE id = $1", [
          noteId,
        ]);
        const filePath = file.rows[0].file;
        if (file.rowCount === 0) {
          return res.status(404).json({ message: "Note not found." });
        }
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        const result = await pool.query(
          `DELETE FROM notes
          WHERE id = $1
          RETURNING *`,
          [noteId]
        );
        console.log(result.rows);
        res.status(200).json({ message: "Note deleted", json: result.rows[0] });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    } else {
      res.status(401).json({ error: "Unauthorize account" });
    }
  }
);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
//its local
