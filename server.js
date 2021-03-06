const express = require('express')
const app = express()
const server = require('http').Server(app)
var io = require("socket.io")(server);
const exec = require('child_process').exec

var visibleFields, jsonBoard;
var mysql = require('mysql');
var bodyParser = require('body-parser');
var session = require('express-session');

// database connection
var connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'sudokuDB',
});

connection.connect(function(err) {
    if (err) {
        console.log('An error occured when connecting to database:', err);
    } else {
        console.log("Server connection went succesfully - go to http://127.0.0.1:8080/");
    }
});

app.use(express.static(__dirname + '/public'));
app.set('views', './views')
app.set('view engine', 'ejs')
app.use(express.urlencoded({
    extended: true
}))
app.use(session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
}));
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

app.get('/', (req, res) => {
    req.session.loggedin = false;
    res.render('login')
});

app.get('/login', (req, res) => {
    req.session.loggedin = false;
    res.render('login')
});

app.post('/login', function(request, response) {
    var username = request.body.username;
    var password = request.body.password;
    if (username && password) {
        connection.query('SELECT * FROM users WHERE NAME = ? AND password = ?', [username, password], function(error, results, fields) {
            if (results.length > 0) {
                request.session.loggedin = true;
                request.session.username = username;
                response.render('index', {
                    rooms: rooms,
                    login: username
                });
            } else {
                response.redirect('/');
            }
            response.end();
        });
    } else {
        response.send('Please enter both Username and Password.');
        response.end();
    }
});

app.post('/activate', function(request, response) {
    async.waterfall([
        function(done) {
            crypto.randomBytes(20, function(err, buf) {
                var token = buf.toString('hex');
                done(err, token);
            });
        },
        function(token, done) {
            var email = request.body.email;
            var username = request.session.username;
            request.session.email = email;

            if (username && email) {
                connection.query('SELECT * FROM users WHERE email = ? AND name = ?', [email, username], function(error, results, fields) {
                    if (results.length <= 0) {
                        // no such account
                        return response.redirect('/activate');
                    } else {
                        connection.query('INSERT INTO tokens(token) VALUES(?)', [token], function(error, results, fields) {
                            if (!error) {
                                // session token set to validate token accessed from external link (email)
                                request.session.token = token;
                                var smtpTransport = nodemailer.createTransport({
                                    service: 'Gmail',
                                    auth: {
                                        user: 'your_gmail_mail',
                                        pass: 'your_password'
                                    },
                                    tls: {
                                        rejectUnauthorized: false
                                    }
                                });
                                var mailOptions = {
                                    to: email,
                                    from: 'Sudoku Multiplayer',
                                    subject: 'Sudoku Account Activation',
                                    text: 'Activate your account using this link:\n\n' + 'http://' + request.headers.host + '/activate/' + token + '\n\n'
                                };

                                smtpTransport.sendMail(mailOptions, function(err) {
                                    done(err, 'done');
                                });
                                response.render('checkemail');
                            } else {
                                response.redirect('/login');
                            }
                        })
                    }
                });
            }
        }
    ])
});

app.get('/activate/:token', function(request, response) {
    if (request.session.token === request.params.token) {

        connection.query('UPDATE users SET activated = 1 WHERE name = ?', [request.session.username], function(error, results) {
            if (!error) {
                response.render('activateconfirmation', {
                    token: request.params.token,
                    user: request.session.username
                });
            } else {
                response.send('Could not activate your account. Contact consumer support for more details ' +
                    'at sudoku.support@fakemail.com');
            }

        });


    } else {
        response.render('login');
    }
});

app.post('/confirm', function(request, response) {
    request.session.username = null;
    request.session.email = null;

    response.redirect('login');
});



app.post('/register1', function(request, response) {
    request.session.loggedin = false;
    response.render('register');
});

app.post('/register2', function(request, response) {
    var username = request.body.username;
    var password = request.body.password;
    if (username && password) {
        connection.query('INSERT INTO users(name, password) VALUES(?, ?)', [username, password], function(error, results, fields) {
            if (!error) {
                request.session.loggedin = true;
                request.session.username = username;
            }
            response.redirect('/login');
            response.end();
        });
    } else {
        response.send('Please enter both Username and Password.');
        response.end();
    }
});


app.get('/index', function(request, response) {
    if (request.session.loggedin) {
        io.emit('update-rooms', rooms);
        response.render('index', {
            rooms: rooms,
            login: this.login
        })
    } else {
        response.send('Please login to view this page!');
    }
    response.end();
});


const rooms = {}

app.post('/room', (req, res) => {
    if (rooms[req.body.room] != null) {
        return res.redirect('/index')
    }
    rooms[req.body.room] = {
        users: {},
        is_game_played: false,
        sudoku_answer: []
    }
    res.redirect(req.body.room)
    // Send message that new room was created
    io.emit('update-rooms', rooms)
})

app.get('/:room', (req, res) => {
    if (rooms[req.params.room] == null) {
        return res.redirect('/index')
    }
    res.render('room', {
        roomName: req.params.room,
        login: this.login
    })
})

server.listen(8080)

io.on('connection', socket => {
    socket.on('new-user', (room, name, points, is_playing, is_eliminated) => {
        socket.join(room)
        rooms[room].users[socket.id] = {
            name,
            points,
            is_playing,
            is_eliminated
        }
        socket.to(room).broadcast.emit('user-connected', name)
    })
    socket.on('send-chat-message', (room, message) => {
        socket.to(room).broadcast.emit('chat-message', {
            message: message,
            name: rooms[room].users[socket.id].name
        })
    });
    socket.on('submit-sudoku', (room, submited_sudoku, id) => {
        if (rooms[room].users[id].has_submitted === false && rooms[room].users[id].is_playing === true) {
            rooms[room].users[id].has_submitted = true;
            rooms[room].users[socket.id].points = calculate_points(1, 0, -1, preprocess_sudoku(submited_sudoku, rooms[room].sudoku_answer));
            io.in(room).emit('first-message', rooms[room].users[id].name);
            var check = sort_results(rooms[room].users);
            if (check !== null) {
                var last_place_id = check[check.length - 1][2];
                rooms[room].users[last_place_id].is_eliminated = true;
                io.in(room).emit('game-has-ended', check);
                rooms[room].is_game_played = false;
            }
        }
    })
    socket.on('start-game', (room, minutes, id, difficulty, gamemode) => {
        if (difficulty == 4) {
            visibleFields = Math.floor((Math.random() * 9) + 70) // 70 or 79
        } else {
            visibleFields = Math.floor((Math.random() * 9) + 27 + (difficulty - 1) * 9) //27,36 or 36,45 or 45,54
        }

        if (rooms[room].is_game_played == false) {
            var no_rounds = Object.keys(rooms[room].users).length - 1;
            start_new_game(room, minutes, socket, gamemode, no_rounds, true);
        }
    })
    socket.on('disconnect', () => {
        getUserRooms(socket).forEach(room => {
            socket.to(room).broadcast.emit('user-disconnected', rooms[room].users[socket.id].name)
            delete rooms[room].users[socket.id]
            if (Object.keys(rooms[room].users).length == 0) {
                delete rooms[room];
                io.emit('update-rooms', rooms);
            }
        })
    });
})

function getUserRooms(socket) {
    return Object.entries(rooms).reduce((names, [name, room]) => {
        if (room.users[socket.id] != null) names.push(name)
        return names
    }, [])
}

function preprocess_sudoku(client_array, solver_array) {
    var correct_fields = 0;
    var void_fields = 0;
    var incorrect_fields = 0;
    for (var a = 0; a < client_array.length; a++) {
        for (var b = 0; b < client_array.length; b++) {
            var c = parseInt(client_array[a][b]);
            if (!isNaN(c)) {
                if (c === solver_array[a][b]) correct_fields++;
                else incorrect_fields++;
            } else {
                if (client_array[a][b] === '') void_fields++;
                else incorrect_fields++;
            }
        }
    }

    return [correct_fields, void_fields, incorrect_fields];
}

function calculate_points(a, b, c, d = [correct_f, void_f, incorrect_f]) {
    return a * d[0] + b * d[1] + c * d[2]
}

function sort_results(associative_array) {
    var array = [];
    for (var user in associative_array) {
        if (associative_array[user].has_submitted === false && associative_array[user].is_playing === true) {
            return null;
        }
        if (associative_array[user].has_submitted === true) {
            array.push([associative_array[user].name, associative_array[user].points - visibleFields, user]);
            if (associative_array[user].is_playing === true) {
                associative_array[user].is_playing = false;
            }
        }
    }
    array.sort(function(a, b) {
        return b[1] - a[1];
    });
    return array;
}

function createBoard(callback) {
    const cmdstring = ' java -cp .\\src generator.BoardCreatorMain ' + visibleFields.toString()
    exec(cmdstring, function(error, stdout, stderr) {
        if (error !== null) {
            console.log("An error occured:" + stderr);
            callback(stderr);
        }
        callback(null, stdout);
        return stdout;
    })
}

function start_new_game(room, minutes, socket, gamemode, no_rounds, is_first_round) {
    createBoard(function(err, out) {
        jsonBoard = out //exec is async, everything what needs a board has to run from here
        const sudoku = JSON.parse(jsonBoard)
        io.in(room).emit('send-minutes-message', {
            minutes: minutes,
            name: rooms[room].users[socket.id].name,
            boolean: rooms[room].is_game_played,
            sudoku: sudoku.start_sudoku
        });

        rooms[room].is_game_played = true;
        rooms[room].sudoku_answer = sudoku.solver;
        for (user in rooms[room].users) {
            rooms[room].users[user].points = 0;
            rooms[room].users[user].has_submitted = false;
            if (gamemode === 5 || is_first_round) {
                rooms[room].users[user].is_eliminated = false;
            }
            if (rooms[room].users[user].is_eliminated === false) {
                rooms[room].users[user].is_playing = true;
            }
        }
        var countdown = 60 * minutes;
        const time = setInterval(function() {
            countdown--;
            io.in(room).emit('timer', {
                countdown: countdown
            });
            if (rooms[room] != null) {
                if (countdown < 1 || rooms[room].is_game_played === false) {
                    clearInterval(time);
                    if (rooms[room] != null) {
                        rooms[room].is_game_played = false;
                        no_rounds--;
                        if (gamemode == 6 && no_rounds > 0) {
                            start_new_game(room, minutes, socket, gamemode, no_rounds, false);
                        }
                    }
                }
            }
        }, 1000);
    });
}