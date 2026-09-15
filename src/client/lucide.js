import {
	ArrowDownToLine, ArrowUpFromLine, Atom, Binary, Box, CircleCheck, Clock3, Copy, createIcons, DatabaseZap,
	Download, FileCog, History, Layers3, List, ListChecks, Orbit, Plus, QrCode,
	Save, ServerCog, Settings, Sparkles, Upload, Waves, X
} from 'lucide';

const icons = {
	ArrowDownToLine, ArrowUpFromLine, Atom, Binary, Box, CircleCheck, Clock3, Copy, DatabaseZap, Download,
	FileCog, History, Layers3, List, ListChecks, Orbit, Plus, QrCode, Save,
	ServerCog, Settings, Sparkles, Upload, Waves, X
};

window.lucide = {
	createIcons(options = {}) {
		return createIcons({ ...options, icons });
	}
};
