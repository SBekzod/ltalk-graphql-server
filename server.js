import { resolve } from "path"
import { config } from "dotenv"
import cors from 'cors';
config({ path: resolve( process.env.NODE_ENV === 'production' ? "./.env" : "./.env.local") });

import http from 'http';
import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { graphqlUploadExpress } from "graphql-upload";
import { schema } from './apollo/schema.js';
import { initialAdmin, verifyIdToken, FirestoreJob } from './lib/firebaseAdmin.js';
import { ApolloError } from 'apollo-server-express';
import { webSession } from "./auth/web-session.js";
import { Database } from './lib/database.js';

// NTALK DATABASE
const db = new Database();
await db.getDatabase();

// INITIALIZING FB ADMIN
initialAdmin();

// FIRESTORE FUNCTION
const firestoreJob = new FirestoreJob();

// USER COLLECTION
const users = new Map();

const formatError = (err) => {
    console.error("--- GraphQL Error ---")
    console.error("Path:", err.path)
    console.error("Message:", err.message)
    console.error("Code:", err.extensions.code)
    console.error("Original Error", err.originalError)
    return err
};

const apolloServer = new ApolloServer({

    schema,
    formatError,

    async context(ctx) {
        let user = {};
        // WHEN SUBSCRIPTION CONNECTED
        if (ctx.connection) {
            console.log('ctx.connection ---------------------------------------');
            console.warn('ssid : ' + ctx.connection.context.ssid);
            console.warn('mbid : ' + ctx.connection.context.mbid);

            if (ctx.connection.context.secret && ctx.connection.context.secret === "ntalki98932flkasjdg98y9244rjkhwaksdf98") {
                user.mbid = ctx.req.headers['mbid'];
                user.name = 'ADMIN';
                user.level = 255;
                user.ip = '0.0.0.0';
                user.role = "admin";
            } else {
                const sessionData = await webSession.getSession(ctx.connection.context.ssid);
                if (sessionData) {
                    // if (!sessionData.ss_mb_id || sessionData.ss_mb_id !== ctx.connection.context.mbid) {
                    //     throw new ApolloError("인증 정보가 없습니다.", "INVALID_AUTH", {parameter: ""});
                    // }

                    user.mbid = sessionData.ss_mb_id ? sessionData.ss_mb_id : '';
                    user.name = sessionData.ss_mb_nick ? sessionData.ss_mb_nick : 'GUEST';
                    user.level = sessionData.ss_mb_level ? sessionData.ss_mb_level : 1;
                    user.ip = sessionData.ss_mb_remote_addr ? sessionData.ss_mb_remote_addr : '0.0.0.0';
                    user.role = sessionData.ss_mb_level === '255' ? "admin" : "user";

                    if (sessionData.hasOwnProperty('ss_mb_extend_style') && sessionData.ss_mb_extend_style) {
                        if (sessionData.hasOwnProperty('ss_mb_extend_style_expire') && sessionData.ss_mb_extend_style_expire) {
                            user.extendStyle = sessionData.ss_mb_extend_style;
                            user.extendStyleExpire = sessionData.ss_mb_extend_style_expire;
                        }
                    }

                    if (! users.has(user.mbid)) {
                        users.set(user.mbid, {name: user.name, level: user.level, ip: user.ip, role: user.role, channels: []});
                    }

                } else {
                    throw new ApolloError("Not exist session id.", "AUTH_SERVER_ERROR", {parameter: ""});
                }
            }

            return {...ctx, user, users};

        } else {
            console.log('ctx.req ---------------------------------------');
            ctx.res.header("Access-Control-Allow-Origin", ctx.req.header('Origin'));

            if (ctx.req.body.operationName === 'IntrospectionQuery') {

            } else {
                //console.warn('context is', ctx.req);
                console.warn('ssid :: ' + ctx.req.headers['ssid']);
                console.warn('mbid :: ' + ctx.req.headers['mbid']);

                if (ctx.req.headers['secret'] && ctx.req.headers['secret'] === "ntalki98932flkasjdg98y9244rjkhwaksdf98") {
                    user.mbid = ctx.req.headers['mbid'];
                    user.name = 'ADMIN';
                    user.level = 255;
                    user.ip = '0.0.0.0';
                    user.role = "admin";
                } else {
                    const sessionData = await webSession.getSession(ctx.req.headers['ssid']);
                    if (sessionData) {
                        // if (!sessionData.ss_mb_id || sessionData.ss_mb_id !== ctx.req.headers['mbid']) {
                        //     throw new ApolloError("인증 정보가 없습니다.", "INVALID_AUTH", {parameter: ""});
                        // }

                        user.mbid = sessionData.ss_mb_id ? sessionData.ss_mb_id : '';
                        user.name = sessionData.ss_mb_nick ? sessionData.ss_mb_nick : 'GUEST';
                        user.level = sessionData.ss_mb_level ? sessionData.ss_mb_level : 1;
                        user.ip = sessionData.ss_mb_remote_addr ? sessionData.ss_mb_remote_addr : '0.0.0.0';
                        user.role = sessionData.ss_mb_level === '255' ? "admin" : "user";

                        if (sessionData.hasOwnProperty('ss_mb_extend_style') && sessionData.ss_mb_extend_style) {
                            if (sessionData.hasOwnProperty('ss_mb_extend_style_expire') && sessionData.ss_mb_extend_style_expire) {
                                user.extendStyle = sessionData.ss_mb_extend_style;
                                user.extendStyleExpire = sessionData.ss_mb_extend_style_expire;
                            }
                        }
                    } else {
                        throw new ApolloError("Not exist session id.", "AUTH_SERVER_ERROR", {parameter: ""});
                    }
                }
            }

            // USER INFORMATION
            if (ctx.req.headers.cookie) {
                const cookie = JSON.parse(decodeURIComponent(ctx.req.headers.cookie.replace('auth=', '')) );
                // console.warn('context',cookie);
                user = await verifyIdToken(cookie.token);
            }
        }

        return {...ctx, user, users, db};
    },

    subscriptions: {
        onConnect: (connectionParams, webSocket, context) => {
            console.log('Connected! ------------------------------------------------');
            return {
                ssid: connectionParams.ssid,
                mbid: connectionParams.mbid,
            };
        },
        onDisconnect: (webSocket, context) => {
            console.log('Disconnected! ------------------------------------------------');
            context.initPromise.then((data) => {
                //console.log(users.entries());
                const user_info = users.get(data.mbid);
                if (user_info) {
                    for (let i = 0; i < user_info.channels.length; i++) {
                        console.log('setChannel : ' + user_info.channels[i]);
                        firestoreJob.setChannel({channel_id: user_info.channels[i], mb_id: data.mbid, is_active: 'N'});
                    }
                }
                users.delete(data.mbid);
            });
        },
        // ...other options...
    },

    uploads: false,
    debug: true,
})

const app = express();

// FOR FILE UPLOAD
app.use(
    '/graphql',
    graphqlUploadExpress({ maxFileSize: 10000000, maxFiles: 10 }),
)

// ENABLE CORS
const whitelist = [
    'http://localhost:4000',
    'http://localhost:8080',
    'http://dev.ntry.com',
    'http://danny.ntrydev.com',
    'http://martin.ntrydev.com',
];
const corsOptions = {
    credentials: true, // This is important.
    origin: (origin, callback) => {
        //console.warn('origin is ', origin);
        if (whitelist.includes(origin))
            return callback(null, true)

        callback(new Error('Not allowed by CORS'));
    }
}

//app.use(cors(corsOptions));

apolloServer.applyMiddleware({ app });

const httpServer = http.createServer(app);

// SUBSCRIPTION HANDLER
apolloServer.installSubscriptionHandlers(httpServer);

// START GRAPHQL SERVER
httpServer.listen({port: 4000}, () => console.log(`🚀 Server ready at http://localhost:4000${apolloServer.graphqlPath}`) );
