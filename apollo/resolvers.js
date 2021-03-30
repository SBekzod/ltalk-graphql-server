import admin from 'firebase-admin';
import {FirestoreJob, pubSubRegister} from "../lib/firebaseAdmin.js";
import {ApolloError} from 'apollo-server-express';
import {GraphQLUpload} from 'graphql-upload';
import {PubSub, withFilter} from 'graphql-subscriptions';
import {TOPIC} from "../config.js";
import Mongodb from 'mongodb';
// .ObjectID


// FIRESTORE FUNCTION
const firestoreJob = new FirestoreJob();
// REGISTER PUBSUB VIA FIRESTORE
const ps = new PubSub();
pubSubRegister(ps);


export const resolvers = {

    // Query -------------------------------------------------------------------------------------
    Query: {

        async channels(_parent, _args, _context, _info) {
            console.log('***** QUERY channels reached server ******')
            const {user} = _context;
            try {
                const {mb_id, start_at, limit} = _args;
                // console.log('AAAAAAAA', _args)
                // console.log('CCCCCCCC', user)

                if (user.mbid !== mb_id && user.role !== "admin") {
                    throw new ApolloError('권한이 없습니다.(1)', "PERMISSION_ERROR", {parameter: ""});
                }

                return await firestoreJob.getChannels({mb_id, start_at, limit});

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async channel(_parent, _args, _context, _info) {
            console.log('***** QUERY channel reached server ******')
            const {user} = _context;
            try {
                const {id} = _args;
                if (user.role !== "admin") {
                    throw new ApolloError('권한이 없습니다.(2)', "PERMISSION_ERROR", {parameter: ""});
                }

                return await firestoreJob.getChannel(id);

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async channelsAdmin(_parent, _args, _context, _info) {
            console.log('***** QUERY channelsAdmin reached server ******')
            const {user} = _context;
            try {
                const {mb_id, start_at, limit} = _args;
                if (user.role !== "admin") {
                    throw new ApolloError('권한이 없습니다.(3)', "PERMISSION_ERROR", {parameter: ""});
                }

                return await firestoreJob.getChannelsAdmin({mb_id, start_at, limit});

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async messages(_parent, _args, _context, _info) {
            console.log('***** QUERY messages reached server ******')
            const {user} = _context;
            try {
                const {channel_id, start_at, limit} = _args;

                return await firestoreJob.getMessages({channel_id, start_at, limit});

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async users(_parent, _args, _context, _info) {
            console.log('***** QUERY users reached server ******')
            const {user} = _context;
            try {
                const {type, start_at, limit} = _args;

                if (type === "blacklist") {
                    let mb_id = user.mbid;
                    const user_data = await firestoreJob.getUser(mb_id);
                    let blacklist = [];
                    if (user_data && user_data.blacklist) {
                        for (let i = 0; i < user_data.blacklist.length; i++) {
                            const black_info = await firestoreJob.getUser(user_data.blacklist[i]);
                            if (black_info) blacklist.push(black_info);
                        }
                    }

                    return blacklist;
                }
                throw new ApolloError('타입을 정확하게 입력해 주세요.', "TYPE_ERROR", {parameter: ""});

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async user(_parent, _args, _context, _info) {
            console.log('***** QUERY user reached server ******')
            const {user} = _context;
            try {
                const {type, keyword} = _args;

                if (type === "id") return await firestoreJob.getUser(keyword);
                if (type === "nick") return await firestoreJob.getUserByNick(keyword);
                throw new ApolloError('타입을 정확하게 입력해 주세요.', "TYPE_ERROR", {parameter: ""});

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        uploads: (parent, args) => {
        },

    },

    // Mutation -------------------------------------------------------------------------------------
    Mutation: {

        async createChannel(_parent, _args, _context, _info) {
            console.log('***** MUTATION createChannel reached server ******')
            const {user, db, mdb} = _context;
            try {
                const {input} = _args;
                console.log('INPUT: ' + input)
                if (user.mbid !== input.opener_mb_id && user.role !== "admin") {
                    throw new ApolloError('권한이 없습니다.(4)', "PERMISSION_ERROR", {parameter: ""});
                }
                if (input.opener_mb_id === input.invitees_mb_id) {
                    throw new ApolloError("자신에게는 채팅을 할 수 없습니다.", "INVALID_USER", {parameter: ""});
                }

                const channel = await firestoreJob.isExistChannel(input.opener_mb_id, input.invitees_mb_id);
                if (channel) {
                    return channel;
                }

                // let opener_info = await db.getUserInfo(input.opener_mb_id);
                // let invitees_info = await db.getUserInfo(input.invitees_mb_id);

                let opener_info = await mdb.collection('users').findOne(Mongodb.ObjectID(input.opener_mb_id))
                let invitees_info = await mdb.collection('users').findOne(Mongodb.ObjectID(input.invitees_mb_id))

                if (!opener_info || !invitees_info) {
                    throw new ApolloError("일치하는 회원정보가 없습니다.", "INVALID_USER", {parameter: ""});
                }

                // changing obj into string
                opener_info['_id'] = `${opener_info['_id']}`
                invitees_info['_id'] = `${invitees_info['_id']}`

                const opener_info_fs = await firestoreJob.getUser(opener_info['_id']);
                const invitees_info_fs = await firestoreJob.getUser(invitees_info['_id']);

                // checking black list
                if (invitees_info_fs.blacklist && invitees_info_fs.blacklist.indexOf(input.opener_mb_id) !== -1) {
                    throw new ApolloError("해당 회원 과는 채팅이 제한 됩니다.", "BLACK_LIST", {parameter: ""});
                }

                let count_channel_ticket = 0;
                // 구독자 자동 응답인 경우 (point or star 차감)
                if (input.channel_type == "AUTO") {
                    if (!opener_info_fs) {
                        count_channel_ticket = 0; //getTicketsPerLevel(opener_info.level);
                    } else {
                        //count_channel_ticket = opener_info_fs.count_channel_ticket;
                        // 사용한 채널 생성권 증가 처리
                        if (opener_info_fs.count_channel_ticket < getTicketsPerLevel(opener_info.level)) {
                            count_channel_ticket = opener_info_fs.count_channel_ticket + 1;
                        } else {
                            throw new ApolloError("신청 제한 횟수를 초과 하였습니다.", "NO_CHANNEL_TICKET", {parameter: ""});
                        }
                    }
                } else {
                    if (!opener_info_fs) {
                        count_channel_ticket = 0; //getTicketsPerLevel(opener_info.level);
                    } else {
                        // 사용한 채널 생성권 증가 처리
                        if(!opener_info.hasOwnProperty('level')) opener_info.level = 1;
                        if (opener_info_fs.count_channel_ticket < getTicketsPerLevel(opener_info.level)) {
                            count_channel_ticket = opener_info_fs.count_channel_ticket + 1;
                        } else {
                            throw new ApolloError("신청 제한 횟수를 초과 하였습니다.", "NO_CHANNEL_TICKET", {parameter: ""});
                        }
                    }
                }

                opener_info = {
                    mb_id: opener_info['_id'],
                    mb_nick: opener_info.username,
                    mb_level: opener_info.level ? opener_info.level : 1,
                    count_channel_ticket: count_channel_ticket,
                    blacklist: opener_info_fs.blacklist ? opener_info_fs.blacklist : [],
                    channellist: opener_info_fs.channellist ? opener_info_fs.channellist : [],
                };

                await firestoreJob.setUser(opener_info);

                if (!invitees_info_fs) {
                    invitees_info = {
                        mb_id: invitees_info['_id'],
                        mb_nick: invitees_info.username,
                        mb_level: invitees_info.level ? invitees_info.level : 1,
                        count_channel_ticket: 0, //getTicketsPerLevel(invitees_info.level),
                        blacklist: [],
                        channellist: [],
                    };

                    await firestoreJob.setUser(invitees_info);
                }

                return await firestoreJob.setChannel(input);

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async updateChannel(_parent, _args, _context, _info) {
            console.log('***** MUTATION updateChannel reached server ******')
            const {user, users} = _context;
            try {
                const {input} = _args;
                if ((input.mb_id && user.mbid !== input.mb_id) && user.role !== "admin") {
                    throw new ApolloError('권한이 없습니다.(5)', "PERMISSION_ERROR", {parameter: ""});
                }

                // 채널 퇴장 처리 (unsubscribe 시 처리 되어야 함)
                if (input.channel_id && input.is_active === "N") {
                    let user_info = users.get(user.mbid);
                    if (user_info) {
                        const index = user_info.channels.indexOf(input.channel_id);
                        if (index !== -1) user_info.channels.splice(index, 1);
                        users.set(user.mbid, user_info);
                    }
                }

                return await firestoreJob.setChannel({...input, mb_id: user.mbid});

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async deleteChannel(_parent, _args, _context, _info) {
            console.log('***** MUTATION deleteChannel reached server ******')
            const {user} = _context;
            try {
                const {id} = _args;
                if ((false && user.mbid !== input.mb_id) && user.role !== "admin") {
                    throw new ApolloError('권한이 없습니다.', "PERMISSION_ERROR", {parameter: ""});
                }

                return await firestoreJob.deleteChannel(id);

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async createMessage(_parent, _args, _context, _info) {
            console.log('***** MUTATION createMessage reached server ******')
            const {user} = _context;
            try {
                const {input} = _args;
                // if (user.mbid !== input.mb_id && user.role !== "admin") {
                //     throw new ApolloError('권한이 없습니다.', "PERMISSION_ERROR", {parameter: ""});
                // }

                // FILE UPLOAD
                // if (input.file) {
                //     console.log('*******----------')
                //     const { file } = input;
                //     const { storage_path, public_url } = await uploadToStorage(file, COLLECTION_PREFIX + 'messages/');
                //     input.storage_path = storage_path;
                //     input.img_url = public_url;
                //     console.warn('after upload', public_url);
                //     delete input.file;
                // }

                return await firestoreJob.setMessage(input);

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async deleteMessage(_parent, _args, _context, _info) {
            console.log('***** MUTATION createMessage reached server ******')
            const {user} = _context;
            try {
                const {id} = _args;
                if (user.role !== "admin") {
                    throw new ApolloError('권한이 없습니다.(6)', "PERMISSION_ERROR", {parameter: ""});
                }

                const info_data = await firestoreJob.getMessage(id);
                if (info_data.storage_path) await deleteFile(info_data.storage_path);

                return await firestoreJob.deleteMessage(id);

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async addBlacklist(_parent, _args, _context, _info) {
            console.log('***** MUTATION addBlacklist reached server ******')
            const {user} = _context;
            try {
                const {mb_id} = _args;
                if (!user.mbid) {
                    throw new ApolloError('권한이 없습니다.(7)', "PERMISSION_ERROR", {parameter: ""});
                }

                let my_data = await firestoreJob.getUser(user.mbid);
                if (!my_data.blacklist) my_data.blacklist = [];
                if (my_data.blacklist.indexOf(mb_id) === -1) my_data.blacklist.push(mb_id);
                await firestoreJob.setUser(my_data);

                return {...my_data};

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

        async removeBlacklist(_parent, _args, _context, _info) {
            console.log('***** MUTATION removeBlacklist reached server ******')
            const {user} = _context;
            //try {
            const {mb_id} = _args;
            if (!user.mbid) {
                throw new ApolloError('권한이 없습니다.(8)', "PERMISSION_ERROR", {parameter: ""});
            }

            let my_data = await firestoreJob.getUser(user.mbid);
            if (!my_data.blacklist) my_data.blacklist = [];
            const index = my_data.blacklist.indexOf(mb_id);
            if (index !== -1) my_data.blacklist.splice(index, 1);
            await firestoreJob.setUser(my_data);

            return {...my_data};

            //} catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        async refillChannelTicket(_parent, _args, _context, _info) {
            console.log('***** MUTATION refillChannelTicket reached server ******')
            const {req, user, db} = _context;
            //try {
            const {type} = _args; // point or star
            const refill_point = 30000;

            let member_info = await db.getMemberInfo(user.mbid);
            if (!member_info) {
                throw new ApolloError("일치하는 회원정보가 없습니다.", "INVALID_USER", {parameter: ""});
            }

            let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
            let user_agent = req.headers['ssid'];
            let mb_point_after = member_info.mb_point - refill_point;
            let mb_star_recv_after = member_info.mb_star_recv - refill_point / 100;

            // point or star 차감
            if (type === "point") {
                if (mb_point_after < 0) throw new ApolloError("리필 포인트가 부족합니다.", "INSUFFICIENT_POINT", {parameter: ""});
                await db.updatePoint(user.mbid, mb_point_after);
                await db.addPointHistory(user.mbid, -refill_point, mb_point_after, member_info.mb_nick, ip, user_agent);
            } else if (type === "star") {
                if (mb_star_recv_after < 0) throw new ApolloError("리필 별사탕이 부족합니다.", "INSUFFICIENT_STAR", {parameter: ""});
                await db.updateStarRecv(user.mbid, mb_star_recv_after);
                await db.addStarRecvHistory(user.mbid, -refill_point / 100, mb_star_recv_after, member_info.mb_nick, ip, user_agent);
            } else {
                throw new ApolloError("잘못된 리필 타입입니다.", "INVALID_REFILL_TYPE", {parameter: ""});
            }

            let my_data = await firestoreJob.getUser(user.mbid);
            let count_channel_ticket = 0; //getTicketsPerLevel(my_data.mb_level);
            my_data = {...my_data, count_channel_ticket: count_channel_ticket};
            await firestoreJob.setUser(my_data);

            return {...my_data};

            //} catch (e) { throw new ApolloError(e, "INTERNAL_SERVER_ERROR", { parameter: "" }); }
        },

        uploadFile: async (parent, {file}) => {
            console.log('***** MUTATION uploadFile reached server ******')
            const {stream, mimetype, filename, encoding, createReadStream} = await file;
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
            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },

    },

    // Subscription -------------------------------------------------------------------------------------
    Subscription: {

        updateChannel: {
            subscribe: withFilter(
                (_parent, _args, _context, _info) => {
                    const {mb_id} = _args;
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
            ),
            resolve: (payload, args, context, info) => {
                //console.warn('payload', payload, context, info)
                // Manipulate and return the new value
                return payload;
            },
        },

        updateMessage: {
            subscribe: withFilter(
                (_parent, _args, _context, _info) => {
                    const {channel_id} = _args;
                    const {user, users} = _context;

                    console.log('***** SUBSCRIPTION updateMessage reached server ******')
                    // console.log('subscribe ---------------------------------');
                    // 채널 입장 처리
                    if (users && user.mbid) {
                        let user_info = users.get(user.mbid);
                        if (user_info) {
                            if (user_info.channels.indexOf(channel_id) === -1) user_info.channels.push(channel_id);
                            users.set(user.mbid, user_info);
                        }
                    }
                    // firestoreJob.getUser(user.mbid).then((user_info) => {
                    //     if (!user_info.channellist) user_info.channellist = [];
                    //     if (user_info.channellist.indexOf(channel_id) === -1) {
                    //         user_info.channellist.push(channel_id);
                    //         firestoreJob.setUser(user_info);
                    //     }
                    // });

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
            ),
            unsubscribe: () => {
                console.log('unsubscribe ===============================');
            },
            resolve: (payload, args, context, info) => {
                //console.warn('payload', payload, context, info)
                // Manipulate and return the new value
                return payload;
            },
        },

        updateChannelAdmin: {
            subscribe: withFilter(
                (_parent, _args, _context, _info) => {
                    const {mb_id} = _args;
                    return ps.asyncIterator(TOPIC.UPDATE_CHANNEL);
                },
                (payload, variables) => {
                    if (variables.mb_id) {
                        // 내가 속한 채널 만 구독
                        if ((payload.opener_mb_id && payload.opener_mb_id === variables.mb_id)
                            || (payload.invitees_mb_id && payload.invitees_mb_id === variables.mb_id)) {
                            return true;
                        } else {
                            return false;
                        }
                    } else {
                        // 전체 채널 구독
                        return true;
                    }
                },
            ),
            resolve: (payload, args, context, info) => {
                // console.warn('payload', payload, context, info)
                // Manipulate and return the new value
                return payload;
            },
        },

        updateMessageAdmin: {
            subscribe: withFilter(
                (_parent, _args, _context, _info) => {
                    const {channel_id} = _args;
                    return ps.asyncIterator(TOPIC.UPDATE_MESSAGE);
                },
                (payload, variables) => {
                    if (variables.channel_id) {
                        // 입장한 채널의 메시지 만 구독
                        if (payload.channel_id && payload.channel_id === variables.channel_id) {
                            return true;
                        } else {
                            return false;
                        }
                    } else {
                        // 전체 채널의 메시지 구독
                        return true;
                    }
                },
            ),
            resolve: (payload, args, context, info) => {
                // console.warn('payload', payload, context, info)
                // Manipulate and return the new value
                return payload;
            },
        },

    },

    // Type -------------------------------------------------------------------------------------
    Channel: {
        users: async (_parent, _args, _context, _info) => {
            try {
                const {opener_mb_id, invitees_mb_id} = _parent;
                const {type} = _args;
                const {user} = _context;
                if (type == "*") {
                    return await firestoreJob.getChannelUsers([opener_mb_id, invitees_mb_id]);
                } else {
                    const others_mb_id = user.mbid === opener_mb_id ? invitees_mb_id : opener_mb_id;
                    return await firestoreJob.getChannelUsers([others_mb_id]);
                }

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },
        messages: async (_parent, _args, _context, _info) => {
            try {
                const {id} = _parent;
                const {limit} = _args;
                return await firestoreJob.getChannelMessages(id, limit);

            } catch (e) {
                throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
            }
        },
    },

    Upload: GraphQLUpload,

}


// OTHER PARTS
// GET TICKETS PER LEVEL
const getTicketsPerLevel = (level) => {
    let count_channel_ticket = 0;
    switch (level) {
        case 1 :
            count_channel_ticket = 3;
            break;
        case 2 :
            count_channel_ticket = 5;
            break;
        case 3 :
            count_channel_ticket = 10;
            break;
        case 4 :
            count_channel_ticket = 15;
            break;
        case 5 :
            count_channel_ticket = 20;
            break;
        case 6 :
            count_channel_ticket = 25;
            break;
        case 7 :
            count_channel_ticket = 30;
            break;
        case 8 :
            count_channel_ticket = 35;
            break;
        case 9 :
            count_channel_ticket = 40;
            break;
        case 255 :
            count_channel_ticket = 1000;
            break;
    }

    return count_channel_ticket;
}

// UPLOAD TO STORAGE
const uploadToStorage = async (file, path) => {
    const {stream, mimetype, filename, encoding, createReadStream} = await file;
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
        return {storage_path, public_url};
    } catch (e) {
        throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
    }
}

// DELETE FILE FROM STORAGE
const deleteFile = async (path) => {
    let bucket = admin.storage().bucket();
    try {
        await bucket.file(path).delete();
    } catch (e) {
        throw new ApolloError(e, "INTERNAL_SERVER_ERROR", {parameter: ""});
    }
}
