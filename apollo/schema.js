import { makeExecutableSchema } from 'graphql-tools'
import { typeDefs } from './type-defs.js'
import { resolvers } from './resolvers.js'

export const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
    introspection: true,
});
