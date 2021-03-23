import admin from 'firebase-admin'
import { COLLECTION_PREFIX, TOPIC } from "../config.js";
import { createFallThroughHandlerFromMap } from "graphql-firestore-subscriptions/dist/index.js";

/**
 * Initializing firebase admin
 * @returns {promise<void>}
 */
export const initialAdmin = async () => {
    const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY
    //console.warn('key', firebasePrivateKey);

    if (!admin.apps?.length) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // https://stackoverflow.com/a/41044630/1332513
                privateKey: firebasePrivateKey.replace(/\\n/g, '\n'),
            }),
            databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
            storageBucket: "moamoa-73602.appspot.com",
        })
    }
}

/**
 * Verifying user token
 * @param token
 * @returns {Promise<auth.DecodedIdToken>}
 */
export const verifyIdToken = async (token) => {
    try {
        const auth_info = await admin.auth().verifyIdToken(token);
        const user_info = await admin.firestore().collection(COLLECTION_PREFIX + 'users').doc(auth_info.uid).get();

        return {...auth_info, ...user_info.data()};
    } catch (e) {
        throw e;
    }
}

/**
 * Register PubSub handler
 * @param ps
 */
export const pubSubRegister = (ps) => {

    console.log('pubSubRegister ##################################################');

    ps.registerHandler(TOPIC.UPDATE_CHANNEL, broadcast =>
        // Note, that `onSnapshot` returns a unsubscribe function which
        // returns void.
        admin.firestore().collection(COLLECTION_PREFIX + 'channels')
            .orderBy('date_last_update', 'desc').onSnapshot(snapshot => {
            snapshot
                .docChanges()
                .filter(change => {
                    //console.warn(change.doc.data())
                    return true; //change.type === 'added'
                })
                .map(item => {
                    //console.warn(item.doc.id, item.doc.data())
                    const parsed = item.doc.data();
                    // const date_created = parsed.date_created ? parsed.date_created.toDate() : 0;
                    const date_created = 0;
                    broadcast({type: item.type, id: item.doc.id, ...parsed, date_created: date_created})
                });
        })
    );

    ps.registerHandler(TOPIC.UPDATE_MESSAGE, broadcast =>
        // Note, that `onSnapshot` returns a unsubscribe function which
        // returns void.
        admin.firestore().collection(COLLECTION_PREFIX + 'messages')
            .orderBy('date_created', 'asc').onSnapshot(snapshot => {
            snapshot
                .docChanges()
                .filter(change => {
                    //console.warn(change.doc.data())
                    return true; //change.type === 'added'
                })
                .map(item => {
                    //console.warn(item.doc.id, item.doc.data())
                    const parsed = item.doc.data();
                    // const date_created = parsed.date_created ? parsed.date_created.toDate() : 0;
                    const date_created = 0
                    broadcast({type: item.type, id: item.doc.id, ...parsed, date_created: date_created});
                });
        })
    );

}

/**
 * Firestore Job
 */
export const FirestoreJob = class FirestoreJob {

    async getChannels({ mb_id }) {
        const channels = await  admin.firestore().collection(COLLECTION_PREFIX + 'channels')
            .where('users', 'array-contains', mb_id).orderBy('date_last_update', 'desc').get();
        let data = channels.docs.map(item => {
            let id = item.id;
            let parsed = item.data();
            return {id, ...parsed, date_created: parsed.date_created.toDate()};
        });

        return data;
    }

    async getMessages({ channel_id, start_at, limit }) {
        console.log(start_at + ' / ' + limit);
        const messages = await admin.firestore().collection(COLLECTION_PREFIX + 'messages')
            .where('channel_id', '==', channel_id).orderBy('index', 'desc').startAt(start_at).limit(limit).get();
        let data = messages.docs.map(item => {
            let id = item.id;
            let parsed = item.data();
            return {id, ...parsed, date_created: parsed.date_created.toDate()};
        });

        return data;
    }

    async getUser(mb_id) {
        const user = await admin.firestore().collection(COLLECTION_PREFIX + 'users').doc(mb_id).get();
        if (! user.exists) return false;
        let parsed = user.data();

        return {id: mb_id, ...parsed};
    }

    async setUser(user_info) {
        let user_data = {
            mb_id: user_info.mb_id,
            mb_nick: user_info.mb_nick,
            mb_level: user_info.mb_level,
            mb_profile_image: user_info.mb_profile_image ? user_info.mb_profile_image : "",
            mb_extend_style: user_info.extend_style ? user_info.extend_style : "",
            count_channel_ticket: user_info.count_channel_ticket,
            blacklist: user_info.blacklist,
        };

        await admin.firestore().collection(COLLECTION_PREFIX + 'users').doc(user_info.mb_id).set(user_data);
    }

    async isExistChannel(opener_mb_id, invitees_mb_id) {
        return false;
    }

    async setChannel(input) {
        if (!input.channel_id) {
            let channel_id = 'CH' + Date.now() + Math.floor(100000 + Math.random() * 899999);
            let final_data = {
                channel_id: channel_id,
                channel_type: input.channel_type,
                channel_title: "notitle",
                is_active: "Y",
                date_created: admin.firestore.FieldValue.serverTimestamp(),
                date_last_update: admin.firestore.FieldValue.serverTimestamp(),
                message_index: 0,
                opener_mb_id: input.opener_mb_id,
                opener_is_active: "N",
                opener_last_message_index: 0,
                opener_last_message_date: Date.now(),
                invitees_mb_id: input.invitees_mb_id,
                invitees_is_active: "N",
                invitees_last_message_index: 0,
                invitees_last_message_date: Date.now(),

                users: [input.opener_mb_id, input.invitees_mb_id],
                message: [],
            };
            await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(channel_id).set(final_data);
            console.warn({id: channel_id, ...final_data});

            return {
                id: channel_id,
                ...final_data,
                date_created: Date.now(),
                date_last_update: Date.now(),
            };
        } else {
            let data = await this.getChannel(input.channel_id);
            if (input.mb_id == data.opener_mb_id) {
                data = {...data, opener_is_active: input.is_active};
            } else {
                data = {...data, invitees_is_active: input.is_active};
            }
            await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(input.channel_id).set(data);

            return data;
        }
    }

    async getChannel(id) {
        const info = await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(id).get();
        const info_data = info.data();

        return {id: info.id, ...info_data};
    }

    async deleteChannel(channel_id) {
        let querySnapshot = await admin.firestore().collection(COLLECTION_PREFIX + 'messages').where("channel_id", "==", channel_id).get();
        querySnapshot.forEach((doc) => {
            //console.warn(doc.id);
            admin.firestore().collection(COLLECTION_PREFIX + 'messages').doc(doc.id).delete();
        });

        const info = await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(channel_id).get();
        const info_data = info.data();
        await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(channel_id).delete();

        return {id: info.id, ...info_data};
    }

    async setMessage(input) {
        let channel = await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(input.channel_id).get();
        let channel_data = channel.data();
        channel_data = {
            ...channel_data,
            message_index: channel_data.message_index + 1,
            date_last_update: Date.now(),
        };

        // UPDATE USER DATA
        if (channel_data.opener_is_active === "Y") {
            channel_data = {
                ...channel_data,
                opener_last_message_index: channel_data.message_index,
                opener_last_message_date: channel_data.date_last_update
            };
        }
        if (channel_data.invitees_is_active === "Y") {
            channel_data = {
                ...channel_data,
                invitees_last_message_index: channel_data.message_index,
                invitees_last_message_date: channel_data.date_last_update
            };
        }

        // SAVE DATA
        let final_data = {
            index: channel_data.message_index,
            channel_id: input.channel_id,
            mb_id: input.mb_id,
            content: input.content,
            date_created: admin.firestore.FieldValue.serverTimestamp(),
        }
        let doc = await admin.firestore().collection(COLLECTION_PREFIX + 'messages').add(final_data);
        await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(input.channel_id).set(channel_data);
        //console.warn({id: doc.id, ...final_data});

        return {id: doc.id, ...final_data, date_created: Date.now()};
    }

    async getMessage(id) {
        const info = await admin.firestore().collection(COLLECTION_PREFIX + 'messages').doc(id).get();
        const info_data = info.data();

        return {id: info.id, ...info_data};
    }

    async deleteMessage(id) {
        await admin.firestore().collection(COLLECTION_PREFIX + 'messages').doc(id).delete();

        return {id};
    }

    async getChannelMessages(channel_id) {
        const messages = await admin.firestore().collection(COLLECTION_PREFIX + 'messages')
            .where('channel_id', '==', channel_id).orderBy('date_created', 'desc').get();
        let data = messages.docs.map(item => {
            let id = item.id;
            let parsed = item.data();
            // return {id, ...parsed, date_created: parsed.date_created.toDate()};
            return {id, ...parsed, date_created: 0};
        });

        return data;
    }

    async getChannelUsers(mb_id) {
        const users = await admin.firestore().collection(COLLECTION_PREFIX + 'users')
            .where('mb_id', '==', mb_id).get();
        let data = users.docs.map(item => {
            let id = item.id;
            let parsed = item.data();
            return {id, ...parsed};
        });

        return data;
    }

}