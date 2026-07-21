import { Router, Request, Response } from 'express';
import { Route, Get, Tags } from 'tsoa';

import { logger, createAuthMW } from 'fa-mcp-sdk';

export const apiRouter: Router | null = Router();

// Create universal auth middleware
const authMW = createAuthMW();

// Example response interfaces for tsoa
export interface ExampleResponse {
  success: boolean;
  message: string;
  data: {
    timestamp: string;
  };
}

/**
 * Example TSOA Controller
 * This demonstrates how to use tsoa decorators for automatic OpenAPI generation
 */
@Route('api')
export class ExampleController {
  /**
   * Example protected endpoint
   * Template endpoint - customize as needed
   */
  @Get('example')
  @Tags('Example')
  public async getExample(): Promise<ExampleResponse> {
    try {
      logger.info('Example endpoint called');

      return {
        success: true,
        message: 'This is a template endpoint',
        data: { timestamp: new Date().toISOString() },
      };
    } catch (error) {
      logger.error('Error in example endpoint:', error);
      throw new Error(error instanceof Error ? error.message : 'Unknown error', { cause: error });
    }
  }

  /**
   * Health check endpoint
   * Simple health check for monitoring
   */
  @Get('health')
  @Tags('Server')
  public async getHealth(): Promise<{
    status: string;
    timestamp: string;
    version: string;
  }> {
    const { appConfig } = await import('fa-mcp-sdk');

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: appConfig.version || '1.0.0',
    };
  }
}

// Manual Express routes for backward compatibility and custom endpoints
// Example protected endpoint using auth middleware
apiRouter.get('/example', authMW, async (req: Request, res: Response) => {
  try {
    logger.info('Example endpoint called');

    res.json({
      success: true,
      message: 'This is a template endpoint',
      data: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error('Error in example endpoint:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
