---@meta yue
---@source
---@class yue
---@field version      string
---@field yue_compiled { [string]: string }
---@field macro_env    { yue: yue, [any]: unknown }
---@field options      yue.Options
---@overload fun(self: yue, yue_module_name: string): ...: unknown
local yue = {}

--- Indicates that a function returns different values depending on whether it
--- succeeded or failed. `T` is returned on success, and `E` on failure.
---
--- Ideally, each function should instead be annotated with an overload so that
--- LuaLS can use one returned type to infer all others, so that a function like
--- `fun(x): yue.Result<number, nil>, yue.Result<nil, string>` would
--- instead be written as something along the lines of
--- `(fun(x): number, nil) | (fun(x): nil, string)`. But the problem with that
--- is that it would be very tedious for me to do so, so I won't :P
---@alias yue.Result<T, E> T | E

---@class yue.AstNode
---@field [1]       string
---@field [2]       integer
---@field [3]       integer
---@field [integer] unknown

---@alias yue.Config.LuaTarget
---| "5.1"
---| "5.2"
---| "5.3"
---| "5.4"

---@class yue.Config
---@field lint_global?          boolean
---@field implicit_return_root? boolean
---@field reserve_line_number?  boolean
---@field space_over_tab?       boolean
---@field private same_module?  boolean
---@field private line_offset?  integer
---@field options?              yue.Options
local Config = {
	lint_global          = false,
	implicit_return_root = true,
	reserve_line_number  = false,
	space_over_tab       = false,
	same_module          = false,
	line_offset          = 0,
	---@class yue.Options
	---@field target?            yue.Config.LuaTarget
	---@field path?              string
	---@field dump_locals?       boolean
	---@field simplified?        boolean
	---@field private dirsep?    string
	---@field private extension? string
	options = {
		target      = "5.4",
		path        = nil,
		dump_locals = false,
		simplified  = true,
		dirsep      = "/",
		extension   = "yue",
	},
}

---@param yue_code string
---@param config?  yue.Config
---@return yue.Result<string,                      nil>    lua_code
---@return yue.Result<nil,                         string> error_message
---@return yue.Result<[string, integer, string][], nil>    globals
function yue.to_lua(yue_code, config) end

---@param file_path string
---@return boolean is_existing
function yue.file_exist(file_path) end

---@param file_path string
---@return string text_content
function yue.read_file(file_path) end

---@param pos? integer
---@return boolean success
function yue.insert_loader(pos) end

---@return boolean success
function yue.remove_loader() end

---@param input      string
---@param chunk_name string
---@param env        { [string]: string }
---@param config?    yue.Config
---@return yue.Result<function, nil>    loaded_function
---@return yue.Result<nil,      string> error_message
---@overload fun(input: string, chunkname: string, config?: yue.Config): loaded_function: yue.Result<function, nil>, error_message: yue.Result<nil, string>
---@overload fun(input: string,                    config?: yue.Config): loaded_function: yue.Result<function, nil>, error_message: yue.Result<nil, string>
function yue.loadstring(input, chunk_name, env, config) end

---@param file_path string
---@param env       { [string]: string }
---@param config?   yue.Config
---@return yue.Result<function, nil>    loaded_function
---@return yue.Result<nil,      string> error_message
---@overload fun(file_path: string, config?: yue.Config): loaded_function: yue.Result<function, nil>, error_message: yue.Result<nil, string>
function yue.loadfile(file_path, env, config) end

---@param file_path string
---@param env       { [string]: string }
---@param config?   yue.Config
---@return yue.Result<function, nil>    loaded_function
---@return yue.Result<nil,      string> error_message
---@overload fun(file_path: string, config?: yue.Config): loaded_function: yue.Result<function, nil>, error_message: yue.Result<nil, string>
function yue.dofile(file_path, env, config) end

---@param yue_module_name string
---@return yue.Result<string, nil>      module_path
---@return yue.Result<nil,    string[]> searched_paths
function yue.find_modulepath(yue_module_name) end

---@generic A
---@generic R
---@param func fun(...: A): ...: R
---@return boolean    success
---@return yue.Result<string, R> ...
function yue.pcall(func) end

---@param yue_module_name string
---@return unknown ...
function yue.require(yue_module_name) end

---@param ... any
---@return nil
function yue.p(...) end

---@param message? string
---@param level?   integer
---@return string traceback_text
function yue.traceback(message, level) end

---@param ast_node_name string
---@param yue_code      string
---@return boolean code_matches_ast_node
function yue.is_ast(ast_node_name, yue_code) end

---@param yue_code         string
---@param flattening_level 0 | 1 | 2
---@param ast_node_name    string
---@return yue.Result<yue.AstNode, nil>    ast
---@return yue.Result<nil,         string> error_message
function yue.to_ast(yue_code, flattening_level, ast_node_name) end

---@param yue_code                                          string
---@param _i_could_not_figure_out_what_this_parameter_does? number
---@return yue.Result<string, nil>    formatted_yue_code
---@return yue.Result<nil,    string> error_message
function yue.format(yue_code, _i_could_not_figure_out_what_this_parameter_does) end

---@param yue_code string
---@param options? yue.Config
---@return yue.Result<string, nil>    formatted_yue_code
---@return [string, string, integer, integer][] error_details
---@return yue.Result<nil,    string> error_message
function yue.check(yue_code, options) end
