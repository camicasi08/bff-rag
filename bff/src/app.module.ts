import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import type { IncomingMessage } from 'http';

import { AuthModule } from './auth/auth.module';
import { DocsModule } from './docs/docs.module';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      playground: true,
      context: ({ req }: { req: IncomingMessage }) => ({ req }),
    }),
    AuthModule,
    RagModule,
    DocsModule,
  ],
})
export class AppModule {}
