import mysql from 'mysql2/promise';

export const Database = class Database {
    constructor() {
        this.db = null;
    }

    async getDatabase() {
        if (!this.db) {
            this.db = await mysql.createPool({
                host: process.env.TALK_DATABASE_HOST,
                user: process.env.TALK_DATABASE_USERNAME,
                password: process.env.TALK_DATABASE_PASSWORD,
                database: process.env.TALK_DATABASE_NAME,
                waitForConnections: true,
                queueLimit: 0,
            });
        }

        return this.db;
    }

    async close() {
        return await this.db.release();
    }

    // NTALK Database
    async getUserInfo(mb_id) {
        const sql = `select * from newworld_talk.users where mb_id = ?`;
        const result = await this.db.query(sql, [mb_id]);

        return result[0][0];
    }

    // NTRY Database
    async getMemberInfo(mb_id) {
        const sql = `select * from newworld_service.member where mb_id = ?`;
        const result = await this.db.query(sql, [mb_id]);

        return result[0][0];
    }

    async updatePoint(mb_id, mb_point) {
        const sql = `update newworld_service.member set mb_point = ? where mb_id = ?`;
        const result = await this.db.query(sql, [mb_point, mb_id]);

        return result;
    }

    async updateStarRecv(mb_id, mb_star_recv) {
        const sql = `update newworld_service.member set mb_star_recv = ? where mb_id = ?`;
        const result = await this.db.query(sql, [mb_star_recv, mb_id]);

        return result;
    }

    async addPointHistory(mb_id, point, balance, rel_value, ip, user_agent) {
        const sql = `INSERT INTO newworld_service.point_log
                        SET
                            mb_id = ?
                            , type = ?
                            , point = ?
                            , balance = ?
                            , rel_value = ?
                            , rel_table = ?
                            , rel_key = ?
                            , ip = ?
                            , user_agent = ?
                            , reg_dt = now()
        `;
        const type = 'CLEAR_TALK_LIMIT';
        const rel_table = 'user';
        const rel_key = Date.now();
        const result = await this.db.query(sql, [mb_id, type, point, balance, rel_value, rel_table, rel_key, ip, user_agent]);

        return result;
    }

    async addStarRecvHistory(mb_id, star_recv, balance, rel_value, ip, user_agent) {
        const sql = `INSERT INTO newworld_service.star_recv_log
                        SET
                            mb_id = ?
                            , type = ?
                            , star_recv = ?
                            , balance = ?
                            , rel_value = ?
                            , rel_table = ?
                            , rel_key = ?
                            , ip = ?
                            , user_agent = ?
                            , reg_dt = now()
        `;
        const type = 'CLEAR_TALK_LIMIT';
        const rel_table = 'user';
        const rel_key = Date.now();
        const result = await this.db.query(sql, [mb_id, type, star_recv, balance, rel_value, rel_table, rel_key, ip, user_agent]);

        return result;
    }

}
