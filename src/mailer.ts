import handlebars from 'handlebars';
import { DateTime } from 'luxon';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import neh from 'nodemailer-express-handlebars';
import path from 'path';

export interface CustomMailOptions extends SendMailOptions {
	template?: string;
	context?: Record<string, any>;
}

const emailDir = path.resolve();

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
});

transport.use(
	'compile',
	neh({
		viewPath: emailDir + '/email',
		viewEngine: {
			extname: '.hbs',
			layoutsDir: emailDir + '/email',
			partialsDir: emailDir + '/email',
			defaultLayout: 'main',
		},
		extName: '.hbs',
	}),
);

export default transport;
