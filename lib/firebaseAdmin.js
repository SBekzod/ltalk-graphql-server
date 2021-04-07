import admin from 'firebase-admin'
import {COLLECTION_PREFIX, TOPIC} from "../config.js";

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

    setTimeout(function () {
        admin.firestore().collection(COLLECTION_PREFIX + 'channels')
            .orderBy('date_last_update', 'desc').limit(1).onSnapshot(snapshot => {
            snapshot
                .docChanges()
                .filter(change => {
                    //console.warn(change.doc.data());
                    return change.type === 'added' || change.type === 'modified';
                })
                .map(item => {
                    //console.warn(item.doc.id, item.doc.data());
                    const parsed = item.doc.data();
                    console.log('FB-CH-SPT: ' + item.type + ' --- ' + item.doc.id + ' / ' + parsed.date_last_update + ' / ' + parsed.opener_mb_id);
                    ps.publish(TOPIC.UPDATE_CHANNEL, {type: item.type, id: item.doc.id, ...parsed});
                });
        });

        admin.firestore().collection(COLLECTION_PREFIX + 'messages')
            .orderBy('date_created', 'desc').limit(1).onSnapshot(snapshot => {
            snapshot
                .docChanges()
                .filter(change => {
                    //console.warn(change.doc.data());
                    return change.type === 'added';
                })
                .map(item => {
                    //console.warn(item.doc.id, item.doc.data());
                    const parsed = item.doc.data();
                    console.log('FB-MG-SPT: ' + parsed.content + ' --- ' + parsed.date_created);
                    ps.publish(TOPIC.UPDATE_MESSAGE, {type: item.type, id: item.doc.id, ...parsed});
                });
        });
    }, 3000);

}

/**
 * Firestore Job
 */
export const FirestoreJob = class FirestoreJob {

    async getChannels({mb_id, start_at, limit}) {
        const channels = await admin.firestore().collection(COLLECTION_PREFIX + 'channels')
            .where('is_active', '==', 'Y').where('users', 'array-contains', mb_id)
            .orderBy('date_created', 'desc').startAt(start_at * 1000).limit(limit).get();
        let channels_data = channels.docs.map(item => {
            let parsed = item.data();
            return {id: item.id, ...parsed};
        });

        return channels_data;
    }

    async getChannelsAdmin({mb_id, start_at, limit}) {
        console.log(start_at + ' // ' + limit);
        let channels = null;
        let channels_data = null;
        if (mb_id) {
            channels = await admin.firestore().collection(COLLECTION_PREFIX + 'channels')
                .where('users', 'array-contains', mb_id)
                .orderBy('date_created', 'desc').startAt(start_at * 1000).limit(limit).get();
            channels_data = channels.docs.map(item => {
                let parsed = item.data();
                return {id: item.id, ...parsed};
            });
        } else {
            channels = await admin.firestore().collection(COLLECTION_PREFIX + 'channels')
                .orderBy('date_created', 'desc').startAt(start_at * 1000).limit(limit).get();
            channels_data = channels.docs.map(item => {
                let parsed = item.data();
                return {id: item.id, ...parsed};
            });
        }

        return channels_data;
    }

    async getMessages({channel_id, start_at, limit}) {
        console.log(start_at + ' / ' + limit);
        const messages = await admin.firestore().collection(COLLECTION_PREFIX + 'messages')
            .where('channel_id', '==', channel_id)
            .orderBy('index', 'desc').startAt(start_at).limit(limit).get();
        let messages_data = messages.docs.map(item => {
            let parsed = item.data();
            return {id: item.id, ...parsed};
        });

        return messages_data;
    }

    async getUser(mb_id) {
        const user = await admin.firestore().collection(COLLECTION_PREFIX + 'users').doc(mb_id).get();
        if (!user.exists) return false;
        let parsed = user.data();
        return {id: mb_id, ...parsed};
    }

    async getUserByNick(mb_nick) {
        const users = await admin.firestore().collection(COLLECTION_PREFIX + 'users')
            .where('mb_nick', '==', mb_nick).limit(1).get();
        let users_data = users.docs.map(item => {
            let parsed = item.data();
            return {id: item.id, ...parsed};
        });

        return users_data[0];
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
            channellist: user_info.channellist ? user_info.channellist : [],
        };

        await admin.firestore().collection(COLLECTION_PREFIX + 'users').doc(user_info.mb_id).set(user_data);
    }

    async isExistChannel(opener_mb_id, invitees_mb_id) {
        const channels = await admin.firestore().collection(COLLECTION_PREFIX + 'channels')
            .where('is_active', '==', 'Y')
            .where('users', 'in', [[opener_mb_id, invitees_mb_id], [invitees_mb_id, opener_mb_id]])
            .limit(1).get();
        let data = channels.docs.map(item => {
            let parsed = item.data();
            return {id: item.id, ...parsed};
        });

        return data[0];
    }

    async setChannel(input) {
        if (!input.channel_id && !input.is_active) {
            let channel_id = 'CH' + Date.now() + Math.floor(100000 + Math.random() * 899999);
            let final_data = {
                channel_id: channel_id,
                channel_type: input.channel_type,
                channel_title: "notitle",
                is_active: "Y",
                date_created: Date.now(), //admin.firestore.FieldValue.serverTimestamp(),
                date_last_update: Date.now(), //admin.firestore.FieldValue.serverTimestamp(),
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
            //console.warn({id: channel_id, ...final_data});

            return {id: channel_id, ...final_data};
        } else {
            let channel_data = await this.getChannel(input.channel_id);
            if (channel_data) {
                if (input.mb_id === channel_data.opener_mb_id) {
                    channel_data = {
                        ...channel_data,
                        opener_is_active: input.is_active,
                        opener_last_message_index: channel_data.message_index,
                        opener_last_message_date: channel_data.date_last_update,
                        date_last_update: Date.now(),
                    };
                } else if (input.mb_id === channel_data.invitees_mb_id) {
                    channel_data = {
                        ...channel_data,
                        invitees_is_active: input.is_active,
                        invitees_last_message_index: channel_data.message_index,
                        invitees_last_message_date: channel_data.date_last_update,
                        date_last_update: Date.now(),
                    };
                }
                await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(input.channel_id).set(channel_data);
            }

            return channel_data;
        }
    }

    async getChannel(id) {
        const channel = await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(id).get();
        const parsed = channel.data();

        return {id: channel.id, ...parsed};
    }

    async getChannelByMemberId(mb_id) {
        let channels = await admin.firestore().collection(COLLECTION_PREFIX + 'channels')
            .where('users', 'array-contains', mb_id).where('invitees_is_active', '==', 'Y').limit(1).get();
        if (!channels.docs[0]) {
            channels = await admin.firestore().collection(COLLECTION_PREFIX + 'channels')
                .where('users', 'array-contains', mb_id).where('opener_is_active', '==', 'Y').limit(1).get();
        }

        let channels_data = channels.docs.map(item => {
            let parsed = item.data();
            return {id: item.id, ...parsed};
        });

        return channels_data[0];
    }

    async deleteChannel(channel_id) {
        let channel_data = await this.getChannel(channel_id);
        if (channel_data) {
            channel_data = {
                ...channel_data,
                is_active: "N",
                date_last_update: Date.now(),
            };
            await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(channel_id).set(channel_data);
        }

        return channel_data;
        // let messages = await admin.firestore().collection(COLLECTION_PREFIX + 'messages')
        //     .where("channel_id", "==", channel_id).get();
        // messages.forEach((doc) => {
        //     admin.firestore().collection(COLLECTION_PREFIX + 'messages').doc(doc.id).delete();
        // });
        //
        // const channel = await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(channel_id).get();
        // const channel_data = channel.data();
        // await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(channel_id).delete();
        //
        // return {id: channel.id, ...channel_data};
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
            date_created: Date.now(), //admin.firestore.FieldValue.serverTimestamp(),
        }
        let doc = await admin.firestore().collection(COLLECTION_PREFIX + 'messages').add(final_data);
        await admin.firestore().collection(COLLECTION_PREFIX + 'channels').doc(input.channel_id).set(channel_data);
        //console.warn({id: doc.id, ...final_data});

        return {id: doc.id, ...final_data};
    }

    async getMessage(id) {
        const message = await admin.firestore().collection(COLLECTION_PREFIX + 'messages').doc(id).get();
        const message_data = message.data();

        return {id: message.id, ...message_data};
    }

    async deleteMessage(id) {
        await admin.firestore().collection(COLLECTION_PREFIX + 'messages').doc(id).delete();

        return {id};
    }

    async getChannelMessages(channel_id, limit) {
        const messages = await admin.firestore().collection(COLLECTION_PREFIX + 'messages')
            .where('channel_id', '==', channel_id).orderBy('date_created', 'desc').limit(limit).get();
        let messages_data = messages.docs.map(item => {
            let parsed = item.data();
            return {id: item.id, ...parsed};
        });

        return messages_data;
    }

    async getChannelUsers(mb_id) {
        const users = await admin.firestore().collection(COLLECTION_PREFIX + 'users')
            .where('mb_id', 'in', mb_id).get();
        let users_data = users.docs.map(item => {
            let parsed = item.data();
            return {id: item.id, ...parsed};
        });

        return users_data;
    }

}