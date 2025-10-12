import type { S3Client } from '@aws-sdk/client-s3';
import * as Dossier from 'dossier';
import { Redis } from 'ioredis';
import type { IUser } from 'models/user.ts';
import type { OauthRequest } from 'types/CustomRequest.ts';
import type { SentryClient } from './types/SentryClient.ts';
import type { StandardResponse } from './types/StandardResponse.ts';

export interface IdsUser extends IUser {
	idsToken?: string;
}

// Extend the Express Application interface
declare global {
	namespace Express {
		// You must use an interface declaration merging approach
		// to add properties to the existing Express Application interface.
		export interface Application {
			/**
			 * The Redis client instance connected to the application.
			 */
			redis: Redis;
			// Add any other custom properties here, e.g.:
			// customConfig: Record<string, any>;

			Sentry: SentryClient;

			s3: S3Client;

			dossier: Dossier;
		}

		export interface Response {
			stdRes: StandardResponse;
		}

		export interface Request {
			user?: IdsUser;
			oauth?: OauthRequest;
		}
	}
}
