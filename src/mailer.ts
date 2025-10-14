import handlebars from 'handlebars';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import neh from 'nodemailer-express-handlebars';
import path from 'path';

export interface CustomMailOptions extends SendMailOptions {
	template?: string;
	context?: Record<string, any>;
}

const emailDir = path.resolve();

handlebars.registerHelper('formatDate', function (date: string) {
	const d = new Date(date);

	const chicago = d.toLocaleString('en-US', {
		timeZone: 'America/Chicago',
		month: '2-digit',
		day: '2-digit',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	});

	// 2. Parse the output string to re-arrange it to your desired format: 'month-day-year hours:minutes ampm'

	// Example output from toLocaleString: "10/11/2025, 8:37 PM"

	// Split the date and time parts
	const [datePart, timePart] = chicago.split(', ');

	// Split the date part (MM/DD/YYYY)
	const [month, day, year] = datePart!.split('/');

	// Split the time and AM/PM parts (H:MM AM/PM)
	const [timeOnly, ampm] = timePart!.split(' ');

	// Reformat to your desired pattern
	return `${month}-${day}-${year} ${timeOnly} ${ampm}`;
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
