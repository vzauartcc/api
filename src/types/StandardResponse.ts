export interface ReturnDetails {
	code: number;
	message: string;
}

export interface StandardResponse {
	ret_det: ReturnDetails | Error;
	data: any;
}
