import http from 'http';
import express from 'express';
import {ApolloServer} from 'apollo-server-express';
import {graphqlUploadExpress} from "graphql-upload";
import {schema} from './apollo/schema.js';
import {FirestoreJob, initialAdmin, verifyIdToken} from './lib/firebaseAdmin.js';
import {Database} from './lib/database.js';
// defination for dotenv package
import {resolve} from "path"
import {config} from "dotenv"

config({path: resolve(process.env.NODE_ENV === 'production' ? "./.env" : "./.env.local")});


// CONNECTING TO ALL FORMS OF DATABASES AND FIRESTORE ADMIN
// mysql database of LTALK
const db = new Database();
try {
    await db.getDatabase();
    console.log('MYSQL connection succeed')
} catch (err) {
    console.log('ERROR MySQL connections: ' + err.message)
}
// initializing of FB admin connection
initialAdmin();
// defining firestore operations
const firestoreJob = new FirestoreJob();
// user collections
const users = new Map();
// defining error formats
const formatError = (err) => {
    console.error("--- GraphQL Error ---")
    console.error("Path:", err.path)
    console.error("Message:", err.message)
    console.error("Code:", err.extensions.code)
    console.error("Original Error", err.originalError)
    return err
};


// APOLLO SERVER BUILT
const apolloServer = new ApolloServer({
    schema,
    formatError,
    async context(ctx) {
        let user = {};
        // WHEN SUBSCRIPTION CONNECTED
        if (ctx.connection) {
            console.log(ctx.connection.context)
            console.log('ctx.connection ---------------------------------------');
            console.warn('ssid : ' + ctx.connection.context.ssid);
            console.warn('mbid : ' + ctx.connection.context.mbid);

            user = {
                ssid: ctx.connection.context.ssid,
                mbid: ctx.connection.context.mbid,
                name: "no", level: "no",
                ip: "no", role: "no"
            }



            if (!users.has(user.mbid)) {
                users.set(user.mbid, {name: user.name, level: user.level, ip: user.ip, role: user.role, channels: []});
            }

            console.log(user)
            return {...ctx, user, users};

        } else {
            console.log('ctx.req ---------------------------------------');
            //console.warn('context is', ctx.req);
            console.warn('ssid :: ' + ctx.req.headers['ssid']);
            console.warn('mbid :: ' + ctx.req.headers['mbid']);

            user = {
                ssid: ctx.req['ssid'],
                mbid: ctx.req['mbid'],
                name: "no", level: "no",
                ip: "no", role: "no"
            }

            // USER INFORMATION
            // if (ctx.req.headers.cookie) {
            //     const cookie = JSON.parse(decodeURIComponent(ctx.req.headers.cookie.replace('auth=', '')));
            //     // console.warn('context',cookie);
            //     user = await verifyIdToken(cookie.token);
            // }


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


// EXPRESS SERVER BUILT
const app = express();
app.use(
    '/graphql',
    graphqlUploadExpress({maxFileSize: 10000000, maxFiles: 10}),
)

// joining two servers: EXPRESS VS APOLLO
apolloServer.applyMiddleware({app});
const server = http.createServer(app);
apolloServer.installSubscriptionHandlers(server);
// starting to listen
server.listen({port: 4000}, () => console.log(`🚀 Server ready at http://localhost:4000${apolloServer.graphqlPath}`));
