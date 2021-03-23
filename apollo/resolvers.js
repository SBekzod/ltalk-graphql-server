import admin from 'firebase-admin';
import { verifyIdToken, pubSubRegister, FirestoreJob } from "../lib/firebaseAdmin.js";
import { ApolloError } from 'apollo-server-express';
import { GraphQLUpload } from 'graphql-upload';
import { withFilter } from 'graphql-subscriptions';
import { COLLECTION_PREFIX, TOPIC } from "../config.js";
import { PubSub } from "graphql-firestore-subscriptions/dist/PubSub.js";

// FIRESTORE FUNCTION
const firestoreJob = new FirestoreJob();

// REGISTER FIRESTORE PUBSUB
const ps = new PubSub();
pubSubRegister(ps);

export const resolvers = {
    // Query -------------------------------------------------------------------------------------
    Query: {

        async channels(_parent, _args, _context, _info) {
            try {
                const { mb_id } = _args;
                return await firestoreJob.getChannels({ mb_id });

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async messages(_parent, _args, _context, _info) {
            try {
                const { user } = _context;
                //if( user.role !== 'admin') throw new ApolloError("You do not have permission.");

                const { channel_id, start_at, limit } = _args;
                console.log(channel_id + ' + ' + start_at + ' + ' + limit);
                return await firestoreJob.getMessages({ channel_id, start_at, limit });

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async user(_parent, _args, _context, _info) {
            try {
                const { id } = _args;
                return await firestoreJob.getUser(id);

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        uploads: (parent, args) => {},

    },
    // Mutation -------------------------------------------------------------------------------------
    Mutation: {

        async createChannel(_parent, _args, _context, _info) {
            const { user, db } = _context;
            //if( user.role !== 'admin') throw new ApolloError('You do not have permission');

            try {
                const { input } = _args;

                if (input.opener_mb_id === input.invitees_mb_id) {
                    throw new ApolloError("자신에게는 채팅을 할 수 없습니다.", "INVALID_USER", { parameter: "" });
                }
                if (await firestoreJob.isExistChannel(input.opener_mb_id, input.invitees_mb_id)) {
                    throw new ApolloError("활성화 된 채널이 이미 존재합니다.", "EXIST_CHANNEL", { parameter: "" });
                }

                let opener_info = await db.getUserInfo(input.opener_mb_id);
                let invitees_info = await db.getUserInfo(input.invitees_mb_id);

                if (!opener_info || !invitees_info) {
                    throw new ApolloError("일치하는 회원정보가 없습니다.", "INVALID_USER", { parameter: "" });
                }

                const opener_info_fs = await firestoreJob.getUser(opener_info.mb_id);
                const invitees_info_fs = await firestoreJob.getUser(invitees_info.mb_id);

                // 블랙 리스트 체크
                if (invitees_info_fs.blacklist && invitees_info_fs.blacklist.indexOf(input.opener_mb_id) !== -1) {
                    throw new ApolloError("해당 회원 과는 채팅이 제한 됩니다.", "BLACK_LIST", { parameter: "" });
                }

                let count_channel_ticket = 0;
                // 구독자 자동 응답인 경우 (point or star 차감)
                if (input.channel_type == "AUTO") {
                    if (! opener_info_fs) {
                        count_channel_ticket = getTicketsPerLevel(opener_info.level);
                    } else {
                        count_channel_ticket = opener_info_fs.count_channel_ticket;
                    }
                } else {
                    if (! opener_info_fs) {
                        count_channel_ticket = getTicketsPerLevel(opener_info.level);
                    } else {
                        // 채널 생성권 감소 처리
                        if (opener_info_fs.count_channel_ticket > 0) {
                            count_channel_ticket = opener_info_fs.count_channel_ticket - 1;
                        } else {
                            throw new ApolloError("채팅방 생성권이 부족합니다.", "NO_CHANNEL_TICKET", {parameter: ""});
                        }
                    }
                }
                opener_info = {
                    mb_id: opener_info.mb_id,
                    mb_nick: opener_info.name,
                    mb_level: opener_info.level,
                    count_channel_ticket: count_channel_ticket,
                    blacklist: opener_info_fs.blacklist ? opener_info_fs.blacklist : [],
                };
                await firestoreJob.setUser(opener_info);

                if (! invitees_info_fs) {
                    invitees_info = {
                        mb_id: invitees_info.mb_id,
                        mb_nick: invitees_info.name,
                        mb_level: invitees_info.level,
                        count_channel_ticket: getTicketsPerLevel(invitees_info.level),
                        blacklist: [],
                    };
                    await firestoreJob.setUser(invitees_info);
                }

                return await firestoreJob.setChannel(input);

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async updateChannel(_parent, _args, _context, _info) {
            const { user } = _context;
            //if( user.role !== 'admin') throw new ApolloError('You do not have permission');

            try {
                const { input } = _args;
                return await firestoreJob.setChannel({...input, mb_id: user.mbid});

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async deleteChannel(_parent, _args, _context, _info) {
            const { user } = _context;
            //if( user.role !== 'admin') throw new ApolloError('You do not have permission');

            try {
                const { id } = _args;
                return await firestoreJob.deleteChannel(id);

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async createMessage(_parent, _args, _context, _info) {
            const { user } = _context;
            //if( user.role !== 'admin') throw new ApolloError('You do not have permission');

            console.log(_args)
            console.log(user)

            try {
                const { input } = _args;
                if ( user.mbid !== input.mb_id) throw new ApolloError('권한이 없습니다.', "PERMISSION_ERROR", { parameter: "" });

                // FILE UPLOAD
                if (input.file) {
                    const { file } = input;
                    const { storage_path, public_url } = await uploadToStorage(file, COLLECTION_PREFIX + 'messages/');
                    input.storage_path = storage_path;
                    input.img_url = public_url;
                    console.warn('after upload', public_url);
                    delete input.file;
                }

                return await firestoreJob.setMessage(input);

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async deleteMessage(_parent, _args, _context, _info) {
            const { user } = _context;
            //if( user.role !== 'admin') throw new ApolloError('You do not have permission');

            try {
                const { id } = _args;
                const info_data = await firestoreJob.getMessage(id);
                if (info_data.storage_path) await deleteFile(info_data.storage_path);

                return await firestoreJob.deleteMessage(id);

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async addBlacklist(_parent, _args, _context, _info) {
            const { user } = _context;
            //if( user.role !== 'admin') throw new ApolloError('You do not have permission');

            try {
                const { mb_id } = _args;
                if ( user.mbid !== mb_id) throw new ApolloError('권한이 없습니다.', "PERMISSION_ERROR", { parameter: "" });

                let my_data = await firestoreJob.getUser(user.mbid);
                if (! my_data.blacklist) my_data.blacklist = [];
                if (my_data.blacklist.indexOf(mb_id) === -1) my_data.blacklist.push(mb_id);
                await firestoreJob.setUser(my_data);

                return {...my_data};

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async removeBlacklist(_parent, _args, _context, _info) {
            const { user } = _context;
            //if( user.role !== 'admin') throw new ApolloError('You do not have permission');

            try {
                const { mb_id } = _args;
                if ( user.mbid !== mb_id) throw new ApolloError('권한이 없습니다.', "PERMISSION_ERROR", { parameter: "" });

                let my_data = await firestoreJob.getUser(user.mbid);
                if (! my_data.blacklist) my_data.blacklist = [];
                if (my_data.blacklist.indexOf(mb_id) !== -1) my_data.blacklist.pop(mb_id);
                await firestoreJob.setUser(my_data);

                return {...my_data};

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async refillChannelTicket(_parent, _args, _context, _info) {
            const { req, user, db } = _context;
            //if( user.role !== 'admin') throw new ApolloError('You do not have permission');

            try {
                const { type } = _args; // point or star
                const refill_point = 30000;

                let member_info = await db.getMemberInfo(user.mbid);
                if (!member_info) {
                    throw new ApolloError("일치하는 회원정보가 없습니다.", "INVALID_USER", { parameter: "" });
                }

                let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
                let user_agent = req.headers['ssid'];
                let mb_point_after = member_info.mb_point - refill_point;
                let mb_star_recv_after = member_info.mb_star_recv - refill_point/100;

                // point or star 차감
                if (type === "point") {
                    if (mb_point_after < 0) throw new ApolloError("리필 포인트가 부족합니다.", "INSUFFICIENT_POINT", { parameter: "" });
                    await db.updatePoint(user.mbid, mb_point_after);
                    await db.addPointHistory(user.mbid, - refill_point, mb_point_after, member_info.mb_nick, ip, user_agent);
                } else if (type === "star") {
                    if (mb_star_recv_after < 0) throw new ApolloError("리필 별사탕이 부족합니다.", "INSUFFICIENT_STAR", { parameter: "" });
                    await db.updateStarRecv(user.mbid, mb_star_recv_after);
                    await db.addStarRecvHistory(user.mbid, - refill_point/100, mb_star_recv_after, member_info.mb_nick, ip, user_agent);
                } else {
                    throw new ApolloError("잘못된 리필 타입입니다.", "INVALID_REFILL_TYPE", { parameter: "" });
                }

                let my_data = await firestoreJob.getUser(user.mbid);
                let count_channel_ticket = getTicketsPerLevel(my_data.mb_level);
                my_data = {...my_data, count_channel_ticket: count_channel_ticket};
                await firestoreJob.setUser(my_data);

                return {...my_data};

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        uploadFile: async (parent, {file}) => {
            const { stream, mimetype, filename, encoding, createReadStream } = await file;
            console.warn('file info', file);
            let bucket = admin.storage().bucket();

            try {
                await new Promise((res, rej) =>
                    createReadStream()
                        .pipe(
                            bucket.file(filename).createWriteStream({
                                resumable: false,
                                gzip: true,
                                metadata: {
                                    contentType: mimetype,
                                    metadata: {
                                        firebaseStorageDownloadTokens: '1212',
                                    },
                                },
                            })
                        )
                        .on("finish", res)
                        .on("error", rej)
                )
                return {filename};
            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

    },
    // Subscription -------------------------------------------------------------------------------------
    Subscription: {

        updateChannel: {
            resolve: (payload, args, context, info) => {
                // console.warn('payload', payload, context, info)
                // Manipulate and return the new value
                return payload;
            },
            subscribe: withFilter(
                (_parent, _args, _context, _info) => {
                    const { mb_id } = _args;
                    return ps.asyncIterator(TOPIC.UPDATE_CHANNEL);
                },
                (payload, variables) => {
                    // 내가 속한 채널 만 구독
                    if ((payload.opener_mb_id && payload.opener_mb_id === variables.mb_id)
                        || (payload.invitees_mb_id && payload.invitees_mb_id === variables.mb_id)) {
                        return true;
                    } else {
                        return false;
                    }
                },
            )
        },

        updateMessage: {
            resolve: (payload, args, context, info) => {
                // console.warn('payload', payload, context, info)
                // Manipulate and return the new value
                return payload;
            },
            subscribe: withFilter(
                (_parent, _args, _context, _info) => {
                    const { channel_id } = _args;
                    return ps.asyncIterator(TOPIC.UPDATE_MESSAGE);
                },
                (payload, variables) => {
                    // 입장한 채널의 메시지 만 구독
                    if (payload.channel_id && payload.channel_id === variables.channel_id) {
                        return true;
                    } else {
                        return false;
                    }
                },
            )
        },

        updateChannelAdmin: {
            resolve: (payload, args, context, info) => {
                // console.warn('payload', payload, context, info)
                // Manipulate and return the new value
                return payload;
            },
            subscribe: withFilter(
                (_parent, _args, _context, _info) => {
                    const { mb_id } = _args;
                    return ps.asyncIterator(TOPIC.UPDATE_CHANNEL);
                },
                (payload, variables) => {
                    // 전체 채널 구독
                    return true;
                },
            )
        },

        updateMessageAdmin: {
            resolve: (payload, args, context, info) => {
                // console.warn('payload', payload, context, info)
                // Manipulate and return the new value
                return payload;
            },
            subscribe: withFilter(
                (_parent, _args, _context, _info) => {
                    const { channel_id } = _args;
                    return ps.asyncIterator(TOPIC.UPDATE_MESSAGE);
                },
                (payload, variables) => {
                    // 전체 채널의 메시지 구독
                    return true;
                },
            )
        },

    },
    // Type -------------------------------------------------------------------------------------
    Channel: {
        messages: async (_parent, _args, _context, _info) => {
            try {
                const { id } = _parent;
                return await firestoreJob.getChannelMessages(id);

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },
        users: async (_parent, _args, _context, _info) => {
            try {
                const { user } = _context;
                let others_mb_id = user.mbid === _parent.opener_mb_id ? _parent.invitees_mb_id : _parent.opener_mb_id;
                return await firestoreJob.getChannelUsers(others_mb_id);

            } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },
    },

    Upload: GraphQLUpload,

}


// GET TICKETS PER LEVEL
const getTicketsPerLevel = (level) => {
    let count_channel_ticket = 0;
    switch (level) {
        case 1 : count_channel_ticket = 10; break;
        case 2 : count_channel_ticket = 20; break;
        case 3 : count_channel_ticket = 30; break;
        case 4 : count_channel_ticket = 40; break;
        case 5 : count_channel_ticket = 50; break;
        case 6 : count_channel_ticket = 60; break;
        case 7 : count_channel_ticket = 70; break;
        case 8 : count_channel_ticket = 80; break;
        case 9 : count_channel_ticket = 90; break;
        case 255 : count_channel_ticket = 1000; break;
    }

    return count_channel_ticket;
}

// UPLOAD TO STORAGE
const uploadToStorage = async ( file, path ) => {
    const { stream, mimetype, filename, encoding, createReadStream } = await file;
    const token = Date.now();
    const filename_arr = filename.split('.');

    const storage_path = `${path}${filename_arr[0]}${token}.${filename_arr.pop()}`;
    console.warn('file info', file);
    let bucket = admin.storage().bucket();

    try {
        await new Promise((res, rej) =>
            createReadStream()
                .pipe(
                    bucket.file(storage_path).createWriteStream({
                        resumable: false,
                        gzip: true,
                        metadata: {
                            contentType: mimetype,
                            metadata: {
                                firebaseStorageDownloadTokens: token,
                            },
                        },
                    })
                )
                .on("finish", res)
                .on("error", rej)
        )
        // GET PUBLIC URL
        // IT IS TO USE ADMIN API
        // let signed_url = await bucket.file(storage_path).getSignedUrl({
        //     action: 'read',
        //     expires: '03-09-2491'
        // })
        let public_url = `https://firebasestorage.googleapis.com/v0/b/moamoa-73602.appspot.com/o/${encodeURIComponent(storage_path)}?alt=media&token=${token}`;
        return { storage_path, public_url };
    } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
}

// DELETE FILE FROM STORAGE
const deleteFile = async (path) => {
    let bucket = admin.storage().bucket();
    try {
        await bucket.file(path).delete();
    } catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
}
