import handlebars from 'handlebars';
import { DateTime } from 'luxon';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import neh from 'nodemailer-express-handlebars';
import path from 'path';

export interface CustomMailOptions extends SendMailOptions {
	template?: string;
	context?: Record<string, any>;
}

const emailDir = path.join(import.meta.dirname, '../email');

handlebars.registerHelper('formatDate', function (date: string) {
	return DateTime.fromJSDate(new Date(date)).setZone('America/Chicago').toFormat('MM-dd-y t');
});

const transport = nodemailer.createTransport({
	host: 'smtp.zoho.com',
	port: 587,
	secure: false,
	requireTLS: true,
	auth: {
		user: 'no-reply@zauartcc.org',
		pass: process.env['EMAIL_PASSWORD'],
	},
	from: {
		name: 'Chicago ARTCC',
		address: 'no-reply@zauartcc.org',
	},
});

transport.use(
	'compile',
	neh({
		viewPath: emailDir,
		viewEngine: {
			extname: '.hbs',
			layoutsDir: emailDir,
			partialsDir: emailDir,
			defaultLayout: 'main',
		},
		extName: '.hbs',
	}),
);

export function sendMail(opts: CustomMailOptions) {
	if (!process.env['EMAIL_PASSWORD']) return;

	transport.sendMail(opts);
}
