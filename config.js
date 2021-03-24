export const COLLECTION_PREFIX = process.env.NODE_ENV === "production" ? "" : "";

export const TOPIC = {
    UPDATE_CHANNEL: 'UPDATE_CHANNEL',
    UPDATE_MESSAGE: 'UPDATE_MESSAGE',
}