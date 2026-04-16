import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { renderGraphqlDocsPage } from './docs.page';

@Controller('docs')
@ApiExcludeController()
export class DocsController {
  @Get('graphql-guide')
  @Header('Content-Type', 'text/html; charset=utf-8')
  graphqlGuide(): string {
    return renderGraphqlDocsPage();
  }
}
