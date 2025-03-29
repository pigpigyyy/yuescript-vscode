
keywords = (
	"and" / "break" / "do" / "else" / "elseif" /
	"end" / "false" / "for" / "function" / "goto" /
	"if" / "in" / "local" / "nil" / "not" /
	"or" / "repeat" / "return" / "then" / "true" /
	"until" / "while" / // Lua keywords
	"as" / "class" / "continue" / "export" / "extends" /
	"from" / "global" / "import" / "macro" / "witch" /
	"try" / "unless" / "using" / "when" / "with" // Yue keywords
);

plain_space = [ \t];
line_break = "\r"? "\n";
any_char = [^\0];
stop = line_break / !.;
comment = "--" [^\r\n]*;
multi_line_open = "--[[";
multi_line_close = "]]";
multi_line_content = (!multi_line_close /* any_char */ .)*;;
multi_line_comment = multi_line_open multi_line_content multi_line_close;
escape_new_line = "\\" ([ \t] / multi_line_comment)* comment? line_break;
space_one = [ \t] / ([-\\] (multi_line_comment / escape_new_line));
space = ([ \t-\\] space_one* comment?)?;
space_break = space line_break;
white = space (line_break space)*;
alpha_num = [a-zA-Z0-9_];
not_alpha_num = !alpha_num;
Name = [a-zA-Z_] alpha_num*; // not_(larger(255));
UnicodeName = ([a-zA-Z_] /* / larger(255) */) (/* larger(255) / */ alpha_num)*;
num_expo = [eE] [+-]? num_char;
num_expo_hex = [pP] [+-]? num_char;
lj_num = [uU]? [lL] [lL];
num_char = [0-9] (("_" [0-9]) / [0-9])*;
num_char_hex = [0-9a-fA-F];
num_lit = num_char_hex (("_" num_char_hex) / num_char_hex)*;
Num = (
	("0x" (
		num_lit+ (
			"." num_lit+ num_expo_hex? /
			num_expo_hex /
			lj_num /* /
			true_() */
		) / (
			"." num_lit+ num_expo_hex?
		)
	)) /
	(num_char+ (
		"." num_char+ num_expo? /
		num_expo /
		lj_num /* /
		true_() */
	)) /
	("." num_char+ num_expo?)
);

Self = "@";
SelfName = "@" (Name / UnicodeName);
SelfClass = "@@";
SelfClassName = "@@" (Name / UnicodeName);

SelfItem = SelfClassName / SelfClass / SelfName / Self;
KeyName = SelfItem / Name / UnicodeName;
VarArg = "...";

//in_block = space_break ([ \t]* line_break)* advance_match ensure(Block, pop_indent);

//LocalFlag = expr("*") / "^";
//LocalValues = NameList (space "=" space (TableBlock / ExpListLow))?;
//Local = key("local") space (LocalFlag / LocalValues);
