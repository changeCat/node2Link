import {
	Atom, Binary, Box, ChevronDown, CircleCheck, Clock3, Copy, createIcons, DatabaseZap,
	Download, FileCog, History, Layers3, List, ListChecks, Orbit, Plus, QrCode,
	Save, ServerCog, Settings, Sparkles, Undo2, Upload, Waves, X
} from 'lucide';

const icons = {
	Atom, Binary, Box, ChevronDown, CircleCheck, Clock3, Copy, DatabaseZap, Download,
	FileCog, History, Layers3, List, ListChecks, Orbit, Plus, QrCode, Save,
	ServerCog, Settings, Sparkles, Undo2, Upload, Waves, X
};

window.lucide = {
	createIcons(options = {}) {
		return createIcons({ ...options, icons });
	}
};
