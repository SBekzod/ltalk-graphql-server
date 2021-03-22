import { gql } from 'apollo-server-express'

export const typeDefs = gql`
  ########################################################
  type Channel {
    type: String    ## added/ modified/ removed
    id: ID!
    channel_id: String!
    channel_type: String!
    channel_title: String!
    is_active: String!
    date_created: String!
    date_last_update: String!
    message_index: Int!
    
    opener_mb_id: String!
    opener_is_active: String
    opener_last_message_index: Int
    opener_last_message_date: String
    invitees_mb_id: String!
    invitees_is_active: String
    invitees_last_message_index: Int
    invitees_last_message_date: String
    
    users: [User]
    messages: [Message]
  }
  
  type Message {
    type: String    ## added/ modified/ removed
    id: ID!
    index: Int!
    channel_id: String!
    mb_id: String!
    content: String!
    date_created: String!
  }
  
  type User {
    id: ID!
    mb_id: String!
    mb_nick: String!
    mb_level: Int!
    mb_profile_image: String
    mb_extend_style: String
    count_channel_ticket: Int
    
    blacklist: [String]
  }
    
  type File {
    filename: String!
    mimetype: String!
    encoding: String!
  }
  
  scalar Upload
  
  ########################################################
  type Query {
    channel(id: ID!): Channel
    channels(mb_id: String!): [Channel]
    message(id: ID!): Message
    messages(channel_id: String!, start_at: Int = 100000, limit: Int = 20): [Message]
    user(id: ID!): User
    users(type: String!): [User]
    
    uploads: [File]
  }
  
  ########################################################
  input ChannelInput {
    channel_type: String
    opener_mb_id: String
    invitees_mb_id: String
    
    channel_id: String
    is_active: String
  }
  
  input MessageInput {
    channel_id: String!
    mb_id: String!
    content: String!
  }
  
  ########################################################
  type Mutation {
    createChannel(input: ChannelInput): Channel
    updateChannel(input: ChannelInput): Channel
    deleteChannel(id: ID!): Channel
    
    createMessage(input: MessageInput): Message
    deleteMessage(id: ID!): Message
    
    addBlacklist(mb_id: String!): User
    removeBlacklist(mb_id: String!): User
    
    refillChannelTicket(type: String!): User
    
    uploadFile(file: Upload!): File!
  }
  
  ########################################################
  type Subscription {
    updateChannel(mb_id: String!): Channel
    updateMessage(channel_id: String!): Message
    
    updateChannelAdmin: Channel
    updateMessageAdmin: Message
  }
  
`