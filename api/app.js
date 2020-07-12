const express = require('express');
const app = express();
const bodyParser = require('body-parser');
require('dotenv').config();

const port = process.env.PORT || 3000;
/* ---Load Mongoose Models--*/
const {
    List,
    Task,
    User
} = require('./db/models');
const {
    verify
} = require('./functions/promisifiedFunctions');

/*---Load Middleware---*/

//Response BodyParser Middleware
app.use(bodyParser.json());
//Cross-Origin Resource Sharing Middleware
//https://enable-cors.org/server.html
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
    res.header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS, PUT, PATCH, DELETE");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-access-token, x-refresh-token, _id");

    res.header(
        'Access-Control-Expose-Headers',
        'x-access-token, x-refresh-token'
    );

    next();
});


// check whether the request has a valid JWT access token
let authenticate = async (req, res, next) => {
    let token = req.header('x-access-token');

    // verify the JWT

    try {
        let decoded = await verify(token, User.getJWTSecret());
        // jwt is valid
        // eslint-disable-next-line require-atomic-updates
        req.user_id = decoded._id;
        next();
    } catch (e) {
        // there was an error
        // jwt is invalid - * DO NOT AUTHENTICATE *
        res.status(401).send(e);
    }
}

// Verify Refresh Token Middleware (which will be verifying the session)
let verifySession = async (req, res, next) => {
    // grab the refresh token from the request header
    let refreshToken = req.header('x-refresh-token');

    // grab the _id from the request header
    let _id = req.header('_id');

    try {
        let user = await User.findByIdAndToken(_id, refreshToken)
        if (!user) {
            // user couldn't be found
            throw new Error('User not found. Make sure that the refresh token and user id are correct')
        }

        // if the code reaches here - the user was found
        // therefore the refresh token exists in the database - but we still have to check if it has expired or not

        req.user_id = user._id;
        req.userObject = user;
        req.refreshToken = refreshToken;

        let isSessionValid = false;

        user.sessions.forEach((session) => {
            if (session.token === refreshToken) {
                // check if the session has expired
                isSessionValid = Boolean(User.hasRefreshTokenExpired(session.expiresAt))
            }
        });

        if (isSessionValid) {
            // the session is VALID - call next() to continue with processing this web request
            next();
        } else {
            // the session is not valid
            throw new Error('Refresh token has expired or the session is invalid')
        }
    } catch (e) {
        res.status(401).send(e);
    }
}
/* END MIDDLEWARE  */


/* -----ROUTE HANDLERS-----*/

/* START OF LIST ROUTES */

/**
 * GET /lists 
 * Purpose: Get all lists that belong to an authenticated user
 * Return: Array of all lists
 */
app.get('/lists', authenticate, async (req, res) => {
    // We want to return an array of all the lists that belong to the authenticated user 
    try {
        res.send(await List.find({
            "_userId": req.user_id
        }))
    } catch (err) {
        res.send(err);
    }
})

/**
 * POST /lists
 * Purpose: Create new list
 * Return: New list document 
 */
app.post('/lists', authenticate, async (req, res) => {
    let newList = new List({
        "title": req.body.title,
        "_userId": req.user_id
    });
    res.send(await newList.save());
});

/**
 * PATCH /lists/:id
 * Purpose: Update specified list
 * Return: http200
 */
app.patch('/lists/:id', authenticate, async (req, res) => {
    //need CORS Headers to use PATCH api
    try {
        await List.findOneAndUpdate({
            "_id": req.params.id,
            "_userId": req.user_id
        }, {
            "$set": req.body
        })
        res.send({
            "message": 'updated successfully'
        });
    } catch (e) {
        res.send({
            "message": e,
            "error": true
        })
    }
});

/**
 * DELETE /lists/:id
 * Purpose: Delete specified list
 * Return: Deleted list doc
 */
app.delete('/lists/:id', authenticate, async (req, res) => {
    let removedListDoc = await List.findOneAndRemove({
        "_id": req.params.id,
        "_userId": req.user_id
    });
    res.send(removedListDoc);
    await deleteTasksFromList(removedListDoc._id);
});

/* END OF LIST ROUTES */
/* ------------------- */
/* START OF TASK ROUTES */

/**
 * GET /lists/:listId/tasks
 * Purpose: Get all task per specified list
 * Return: Array of all tasks
 */
app.get('/lists/:listId/tasks', authenticate, async (req, res) => {
    res.send(await Task.find({
        "_listId": req.params.listId
    }));
});

/**
 * GET /lists/:listId/task/:taskId
 * Purpose: Get a single task in specified list
 * Return: Specified task doc
 */
app.get('/lists/:listId/tasks/:taskId', authenticate, async (req, res) => {
    res.send(await Task.findOne({
        "_id": req.params.taskId,
        "_listId": req.params.listId
    }))
});

/**
 * POST /lists/:listId/tasks 
 * Purpose: Create new task in specified list
 * Return: The new task document
 */
app.post('/lists/:listId/tasks', authenticate, async (req, res) => {
    //check if authenticated user has access to list id passed in
    let list = await List.findOne({
        "_id": req.params.listId,
        "_userId": req.user_id
    });
    if (list) {
        let newTask = new Task({
            "title": req.body.title,
            "_listId": req.params.listId
        });
        newTask.save().then((newTaskDoc) => {
            res.send(newTaskDoc);
        });
    } else {
        res.sendStatus(404);
    }
});

/**
 * PATCH /lists/:listId/tasks/:taskId
 * Purpose: Update an existing task
 */
app.patch('/lists/:listId/tasks/:taskId', authenticate, async (req, res) => {
    // We want to update an existing task (specified by taskId)
    let list = await List.findOne({
        "_id": req.params.listId,
        "_userId": req.user_id
    })
    if (list) {
        // the currently authenticated user can update tasks
        await Task.findOneAndUpdate({
            "_id": req.params.taskId,
            "_listId": req.params.listId
        }, {
            "$set": req.body
        })
        res.send({
            "message": 'Updated successfully.'
        });
    } else {
        res.sendStatus(404);
    }

});

/**
 * DELETE /lists/:listId/tasks/:taskId
 * Purpose: Delete a task
 */
app.delete('/lists/:listId/tasks/:taskId', authenticate, async (req, res) => {

    let list = await List.findOne({
        "_id": req.params.listId,
        "_userId": req.user_id
    });
    if (list) {
        res.send(await Task.findOneAndRemove({
            "_id": req.params.taskId,
            "_listId": req.params.listId
        }));
    } else {
        res.sendStatus(404);
    }
});


/* END OF TASK ROUTES */
/* ------------------- */
/* START OF USER ROUTES */

/**
 * POST /users/signup
 * Purpose: Create user
 * Return: User document
 */
app.post('/users/signup', (req, res) => {
    //user sign up
    let newUser = new User(req.body);
    newUser.save().then(() => {
        return newUser.createSession();
    }).then((refreshToken) => {
        //session created successfully - refresh token also returned
        //now we have to generate access auth token for the user
        return newUser.generateAccessAuthToken().then((accessToken) => {
            //access auth token generated successfully
            return {
                accessToken,
                refreshToken
            };
        });
    }).then((authTokens) => {
        //now we construct and send the response to the user with their
        //auth token in header, and the user object in the body
        res
            .header('x-refresh-token', authTokens.refreshToken)
            .header('x-access-token', authTokens.accessToken)
            .send(newUser);
    }).catch((err) => {
        res.status(400).send(err);
    });
});

/**
 * POST /users/login
 * Purpose: Login user
 * Return: User document and redirect to taskview
 */
app.post('/users/login', (req, res) => {
    let email = req.body.email;
    let password = req.body.password;

    User.findByCredentials(email, password).then((user) => {
        return user.createSession().then((refreshToken) => {
            //Session created successfully - refreshToken returned
            //n ow we generate an access auth token for the user

            return user.generateAccessAuthToken().then((accessToken) => {
                //access auth token generated successfully, 
                //now we return an object containing the auth token
                return {
                    accessToken,
                    refreshToken
                }
            });
        }).then((authTokens) => {
            res
                .header('x-refresh-token', authTokens.refreshToken)
                .header('x-access-token', authTokens.accessToken)
                .send(user);
        });
    }).catch((err) => {
        res.status(400).send(err);
    });
});

/**
 * GET /users/me/access-token
 * Purpose: generates and returns an access token
 */
app.get('/users/me/access-token', verifySession, (req, res) => {
    // we know that the user/caller is authenticated and we have the user_id and user object available to us
    req.userObject.generateAccessAuthToken().then((accessToken) => {
        res.header('x-access-token', accessToken).send({
            accessToken
        });
    }).catch((e) => {
        res.status(400).send(e);
    });
});

/* HELPER METHODS */
let deleteTasksFromList = async (_listId) => {
    await Task.deleteMany({
        _listId
    })
    console.log(`Tasks from ${_listId} were all deleted, because respective list was deleted`);
}

app.listen(port, () => {
    console.log(`server is listening on port ${port}`);
});