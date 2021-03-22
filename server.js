import {resolve} from "path"
import {config} from "dotenv"
import http from 'http';
import express from 'express';
import {ApolloServer} from 'apollo-server-express';
import {graphqlUploadExpress} from "graphql-upload";
import {schema} from './apollo/schema.js';
import {initialAdmin} from './lib/firebaseAdmin.js';
import {Database} from './lib/database.js';
config({path: resolve(process.env.NODE_ENV === 'production' ? "./.env" : "./.env.local")});




// INITIALIZING ALL DB CONNECTIONS TO PASS INTO APOLLO SERVER'S CONTEXT
// on MYSQL connection
console.log('PASSING HERE')
const db = new Database();
try {
    await db.getDatabase();
    console.log('MYSQL connection succeed')
} catch (err) {
    console.log('ERROR MySQL connections: ' + err.message)
}
// on FireBase admin connection
initialAdmin();




// APOLLO SERVER BUILD
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
            console.log('PASSED HERE - 1')
            //console.log(ctx.payload);
            console.warn('ssid : ' + ctx.connection.context.ssid);
            console.warn('mbid : ' + ctx.connection.context.mbid);
        } else {
            console.log('PASSED HERE - 2')
        }

        return {...ctx, user, db}
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
                console.log(data);
            });
        },
    },
    uploads: false,
    debug: true,
})




// EXPRESS SERVER BUILD
const app = express();
// providing url-link for graphql browser test
app.use(
    '/graphql',
    graphqlUploadExpress({maxFileSize: 10000000, maxFiles: 10}),
)
// Enabling white list
const whitelist = [
    'http://localhost:3003',
    'http://martin.ntrydev.com',
];
const corsOptions = {
    credentials: true,
    origin: (origin, callback) => {
        if (whitelist.includes(origin))
            return callback(null, true)
        callback(new Error('Not allowed by CORS'));
    }
}


// JOINING EXPRESS INTO APOLLO SERVER
apolloServer.applyMiddleware({app});
const server = http.createServer(app);
// SUBSCRIPTION HANDLER
apolloServer.installSubscriptionHandlers(server);
// START GRAPHQL SERVER
server.listen({port: 4000}, () => console.log(`🚀 Server ready at http://localhost:4000${apolloServer.graphqlPath}`));
