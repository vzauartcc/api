import nodemailer from 'nodemailer';
import neh from 'nodemailer-express-handlebars';
import path from 'path';
import handlebars from 'handlebars';

const emailDir = path.resolve();

handlebars.registerHelper('formatDate', function (date) {
	var d = new Date(date);
	var chicagoTime = new Date(d.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
	var month = ('0' + (chicagoTime.getMonth() + 1)).slice(-2);
	var day = ('0' + chicagoTime.getDate()).slice(-2);
	var year = chicagoTime.getFullYear();
	var hours = chicagoTime.getHours();
	var minutes = ('0' + chicagoTime.getMinutes()).slice(-2);
	var ampm = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12;
	hours = hours ? hours : 12;
	return month + '-' + day + '-' + year + ' ' + hours + ':' + minutes + ' ' + ampm;
});

const transport = nodemailer.createTransport({
	host: 'smtp.zoho.com',
	port: 587,
	secure: false,
	requireTLS: true,
	auth: {
		user: 'no-reply@zauartcc.org',
		pass: process.env.EMAIL_PASSWORD,
	},
});

transport.use(
	'compile',
	neh({
		viewPath: emailDir + '/email',
		viewEngine: {
			extName: '.hbs',
			layoutsDir: emailDir + '/email',
			partialsDir: emailDir + '/email',
			defaultLayout: 'main',
		},
		extName: '.hbs',
	}),
);

export default transport;

// organizational email list
// atm@zauartcc.org
// datm@zauartcc.org
// ta@zauartcc.org
// ec@zauartcc.org
// webmaster@zauartcc.org //maybe do wm@zauartcc.org
// fe@zauartcc.org
// management@zauartcc.org
