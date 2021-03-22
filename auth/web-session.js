import { resolve } from "path"
import { config } from "dotenv"
import Memcached from 'memcached';
import phpUnSerialize from 'php-unserialize';
config({ path: resolve( process.env.NODE_ENV === 'production' ? "./.env" : "./.env.local") });

const webSessionAddress = `${process.env.WEB_SESSION_HOST}:${parseInt(process.env.WEB_SESSION_PORT)}`;
const memcached = new Memcached(webSessionAddress);
const __WebSession__ = {};

/**
 * Return php deserialuzed web session data
 *
 * @param ssid
 * @eturns {Promise}
 */
__WebSession__.getSession = (ssid) => {
    return new Promise((resolve, reject) => {
        if (!ssid) {
            return reject('Unexpected session id.');
        }

        // 개발 완료 후 삭제 처리!!
        // let unSerialized = {};
        // unSerialized.ss_mb_id = null;
        // unSerialized.ss_mb_nick = null;
        // unSerialized.ss_mb_level = null;
        // unSerialized.ss_mb_remote_addr = null;
        // resolve(unSerialized);

        memcached.get(ssid, (err, session) => {
            if (err) {
                return reject(err);
            }
            if (!session) {
                return reject('Not exist session id.');
            }
            let unSerialized = phpUnSerialize.unserializeSession(session);

            resolve(unSerialized);
        });
    });
};

export const webSession = __WebSession__;