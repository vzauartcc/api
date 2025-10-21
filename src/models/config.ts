import { Document, model, Schema } from 'mongoose';

interface IConfig extends Document {
	id: string;
	arConfig1: string;
	arConfig2: string;
	arConfig3: string;
	arConfig4: string;
	drConfig1: string;
	drConfig2: string;
	drConfig3: string;
	drConfig4: string;
	drConfig5: string;
	ssatConfig1: string;
	ssatConfig2: string;
	ssatConfig3: string;
	ssatConfig4: string;
	lcConfig1: string;
	lcConfig2: string;
	lcConfig3: string;
	lcConfig4: string;
	mdwLcConfig1: string;
	mdwLcConfig2: string;
	ordGcConfig1: string;
	ordGcConfig2: string;
	ordGcConfig3: string;
	mdwGcConfig1: string;
	mdwGcConfig2: string;
	mdwGcConfig3: string;
	cdConfig1: string;
	cdConfig2: string;
	ordAfldConfig1: string;
	ordAfldConfig2: string;
	ordAfldConfig3: string;
	mdwAfldConfig1: string;
	mdwAfldConfig2: string;
	mdwAfldConfig3: string;
	ordDeprwyConfig1: string;
	ordDeprwyConfig2: string;
	mdwDeprwyConfig1: string;
	mdwDeprwyConfig2: string;
	mdwArrrwyConfig1: string;
	mdwArrrwyConfig2: string;
	ordArrrwyConfig1: string;
	ordArrrwyConfig2: string;
	ordApptype1: string;
	mdwApptype2: string;
	mdwFlow: string;
	ordFlow: string;
	tmuOnline: boolean;
	textInput: string;
	pekue: string;
	olinn: string;
	noony: string;
	mykie: string;
	pmpkn: string;
	raynr: string;
	ebake: string;
	dufee: string;
	moble: string;
	lewke: string;
	earnd: string;
	dennt: string;
	cmsky: string;
	bacen: string;
	acito: string;
	pekueStatus: string;
	olinnStatus: string;
	noonyStatus: string;
	mykieStatus: string;
	pmpknStatus: string;
	raynrStatus: string;
	ebakeStatus: string;
	dufeeStatus: string;
	mobleStatus: string;
	lewkeStatus: string;
	earndStatus: string;
	denntStatus: string;
	cmskyStatus: string;
	bacenStatus: string;
	acitoStatus: string;
	departureGroundStop: string;
	cictextInput: string;
	sataptConfig1: string;
	sataptConfig2: string;
	sataptConfig3: string;
	sataptConfig4: string;
	sataptConfig5: string;
	sataptConfig6: string;
}

const ConfigSchema = new Schema<IConfig>({
	id: { type: String, required: true },
	arConfig1: { type: String, required: true },
	arConfig2: { type: String, required: true },
	arConfig3: { type: String, required: true },
	arConfig4: { type: String, required: true },
	drConfig1: { type: String, required: true },
	drConfig2: { type: String, required: true },
	drConfig3: { type: String, required: true },
	drConfig4: { type: String, required: true },
	drConfig5: { type: String, required: true },
	ssatConfig1: { type: String, required: true },
	ssatConfig2: { type: String, required: true },
	ssatConfig3: { type: String, required: true },
	ssatConfig4: { type: String, required: true },
	lcConfig1: { type: String, required: true },
	lcConfig2: { type: String, required: true },
	lcConfig3: { type: String, required: true },
	lcConfig4: { type: String, required: true },
	mdwLcConfig1: { type: String, required: true },
	mdwLcConfig2: { type: String, required: true },
	ordGcConfig1: { type: String, required: true },
	ordGcConfig2: { type: String, required: true },
	ordGcConfig3: { type: String, required: true },
	mdwGcConfig1: { type: String, required: true },
	mdwGcConfig2: { type: String, required: true },
	mdwGcConfig3: { type: String, required: true },
	cdConfig1: { type: String, required: true },
	cdConfig2: { type: String, required: true },
	ordAfldConfig1: { type: String, required: true },
	ordAfldConfig2: { type: String, required: true },
	ordAfldConfig3: { type: String, required: true },
	mdwAfldConfig1: { type: String, required: true },
	mdwAfldConfig2: { type: String, required: true },
	mdwAfldConfig3: { type: String, required: true },
	ordDeprwyConfig1: { type: String, required: true },
	ordDeprwyConfig2: { type: String, required: true },
	mdwDeprwyConfig1: { type: String, required: true },
	mdwDeprwyConfig2: { type: String, required: true },
	mdwArrrwyConfig1: { type: String, required: true },
	mdwArrrwyConfig2: { type: String, required: true },
	ordArrrwyConfig1: { type: String, required: true },
	ordArrrwyConfig2: { type: String, required: true },
	ordApptype1: { type: String, required: true },
	mdwApptype2: { type: String, required: true },
	mdwFlow: { type: String, required: true },
	ordFlow: { type: String, required: true },
	tmuOnline: { type: Boolean, required: true },
	textInput: { type: String, required: true },
	pekue: { type: String, required: true },
	olinn: { type: String, required: true },
	noony: { type: String, required: true },
	mykie: { type: String, required: true },
	pmpkn: { type: String, required: true },
	raynr: { type: String, required: true },
	ebake: { type: String, required: true },
	dufee: { type: String, required: true },
	moble: { type: String, required: true },
	lewke: { type: String, required: true },
	earnd: { type: String, required: true },
	dennt: { type: String, required: true },
	cmsky: { type: String, required: true },
	bacen: { type: String, required: true },
	acito: { type: String, required: true },
	pekueStatus: { type: String, required: true },
	olinnStatus: { type: String, required: true },
	noonyStatus: { type: String, required: true },
	mykieStatus: { type: String, required: true },
	pmpknStatus: { type: String, required: true },
	raynrStatus: { type: String, required: true },
	ebakeStatus: { type: String, required: true },
	dufeeStatus: { type: String, required: true },
	mobleStatus: { type: String, required: true },
	lewkeStatus: { type: String, required: true },
	earndStatus: { type: String, required: true },
	denntStatus: { type: String, required: true },
	cmskyStatus: { type: String, required: true },
	bacenStatus: { type: String, required: true },
	acitoStatus: { type: String, required: true },
	departureGroundStop: { type: String, required: true },
	cictextInput: { type: String, required: true },
	sataptConfig1: { type: String, required: true },
	sataptConfig2: { type: String, required: true },
	sataptConfig3: { type: String, required: true },
	sataptConfig4: { type: String, required: true },
	sataptConfig5: { type: String, required: true },
	sataptConfig6: { type: String, required: true },
});

export const ConfigModel = model<IConfig>('Config', ConfigSchema);
