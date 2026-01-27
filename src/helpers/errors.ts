import status from '../types/status.js';

function throwException(code: keyof typeof status, msg?: string, options?: any): never {
	throw {
		...options,
		code: code,
		name: `${code} - ${status[code]} - ${status[`${code}_MESSAGE` as keyof typeof status]}`,
		message: msg || '',
	};
}

export function throwBadRequestException(msg?: string, options?: any): never {
	throwException(status.BAD_REQUEST, msg, options);
}

export function throwUnauthorizedException(msg?: string, options?: any): never {
	throwException(status.UNAUTHORIZED, msg, options);
}

export function throwForbiddenException(msg?: string, options?: any): never {
	throwException(status.FORBIDDEN, msg, options);
}

export function throwNotFoundException(msg?: string, options?: any): never {
	throwException(status.NOT_FOUND, msg, options);
}

export function throwConflictException(msg?: string, options?: any): never {
	throwException(status.CONFLICT, msg, options);
}

export function throwTooManyRequestsException(msg?: string, options?: any): never {
	throwException(status.TOO_MANY_REQUESTS, msg, options);
}

export function throwInternalServerErrorException(msg?: string, options?: any): never {
	throwException(status.INTERNAL_SERVER_ERROR, msg, options);
}

export function throwServiceUnavailableException(msg?: string, options?: any): never {
	throwException(status.SERVICE_UNAVAILABLE, msg, options);
}
