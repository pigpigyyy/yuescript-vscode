export type Root<ScopeName extends string> = {
	name: string;
	scopeName: `source.${ScopeName}`;
	fileTypes?: string[];
	firstLineMatch?: RegExp | string;
	foldingStartMarker?: RegExp | string;
	foldingStopMarker?: RegExp | string;
	uuid?: string;
	patterns?: Pattern<ScopeName>[];
	repository?: Repository<ScopeName>;
};

// Index `"0"` is always the full pattern, while `"1"`, `"2"` and so on are the
// unnamed capture groups with the given index.
//
// Alternatively, the index may also refer to a named capture, e.g. with the
// pattern `(?<identifier>[a-zA-Z_]\w*)`, the index would be `"identifier"`.
export type Captures<ScopeName extends string> = Record<string, Pattern<ScopeName>>/* {
	[P in string]: Pattern<ScopeName>;
} */;

export type Repository<ScopeName extends string> = Record<string, {
	name?: string;
	patterns?: Pattern<ScopeName>[];
}>;

export type Grammar<ScopeName extends string> = {
	patterns?: Pattern<ScopeName>[];
	repository?: Repository<ScopeName>;
};

export type Pattern<ScopeName extends string> = {
	disabled?: 0 | 1;
	comment?: string;
	include?: "$self" | `#${string}`;
	match?: RegExp | string;
	name?: PatternName<ScopeName> | string;
	contentName?: string;
	begin?: RegExp | string;
	end?: RegExp | string;
	while?: string;
	captures?: Captures<ScopeName>;
	beginCaptures?: Captures<ScopeName>;
	endCaptures?: Captures<ScopeName>;
	whileCaptures?: string;
	patterns?: Pattern<ScopeName>[];
	applyEndPatternLast?: 0 | 1;
};

export type PatternName<ScopeName extends string> = (
	`${PatternNameBase}.${ScopeName}`
);

export type PatternNameBase = (
	| "comment"
	| "comment.block"
	| "comment.block.documentation"
	| "comment.line"
	| "comment.line.double-dash"
	| "comment.line.double-slash"
	| "comment.line.number-sign"
	| "comment.line.percentage"
	| "constant"
	| "constant.character"
	| "constant.character.escape"
	| "constant.language"
	| "constant.numeric"
	| "constant.other"
	| "constant.regexp"
	| "constant.rgb-value"
	| "constant.sha.git-rebase"
	| "emphasis"
	| "entity"
	| "entity.name"
	| "entity.name.class"
	| "entity.name.function"
	| "entity.name.method"
	| "entity.name.section"
	| "entity.name.selector"
	| "entity.name.tag"
	| "entity.name.type"
	| "entity.other"
	| "entity.other.attribute-name"
	| "entity.other.inherited-class"
	| "header"
	| "invalid"
	| "invalid.deprecated"
	| "invalid.illegal"
	| "keyword"
	| "keyword.control"
	| "keyword.control.less"
	| "keyword.operator"
	| "keyword.operator.new"
	| "keyword.other"
	| "keyword.other.unit"
	| "markup"
	| "markup.bold"
	| "markup.changed"
	| "markup.deleted"
	| "markup.heading"
	| "markup.inline.raw"
	| "markup.inserted"
	| "markup.italic"
	| "markup.list"
	| "markup.list.numbered"
	| "markup.list.unnumbered"
	| "markup.other"
	| "markup.punctuation.list.beginning"
	| "markup.punctuation.quote.beginning"
	| "markup.quote"
	| "markup.raw"
	| "markup.underline"
	| "markup.underline.link"
	| "meta"
	| "meta.cast"
	| "meta.parameter.type.variable"
	| "meta.preprocessor"
	| "meta.preprocessor.numeric"
	| "meta.preprocessor.string"
	| "meta.return-type"
	| "meta.selector"
	| "meta.structure.dictionary.key.python"
	| "meta.tag"
	| "meta.type.annotation"
	| "meta.type.name"
	| "metatag.php"
	| "storage"
	| "storage.modifier"
	| "storage.modifier.import.java"
	| "storage.modifier.package.java"
	| "storage.type"
	| "storage.type.cs"
	| "storage.type.java"
	| "string"
	| "string.html"
	| "string.interpolated"
	| "string.jade"
	| "string.other"
	| "string.quoted"
	| "string.quoted.double"
	| "string.quoted.other"
	| "string.quoted.single"
	| "string.quoted.triple"
	| "string.regexp"
	| "string.unquoted"
	| "string.xml"
	| "string.yaml"
	| "strong"
	| "support"
	| "support.class"
	| "support.constant"
	| "support.function"
	| "support.function.git-rebase"
	| "support.other"
	| "support.property-value"
	| "support.type"
	| "support.type.property-name"
	| "support.type.property-name.css"
	| "support.type.property-name.less"
	| "support.type.property-name.scss"
	| "support.variable"
	| "variable"
	| "variable.assignment"
	| "variable.language"
	| "variable.name"
	| "variable.other"
	| "variable.parameter"
);
