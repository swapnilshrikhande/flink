//     js-shell
//     (c) 2016 Swapnil Shrikhande
//     js-shell may be freely distributed under the MIT license.
//     For all details and documentation: // github.io link

// TODO
// Create session variable in context to maintain data for throughtout the session.

//enter key plugin
$.fn.enterKey = function (fnc) {
    return this.each(function () {
        $(this).keypress(function (ev) {
            var keycode = (ev.keyCode ? ev.keyCode : ev.which);
            if (keycode == '13') {
                fnc.call(this, ev);
            }
        })
    })
};

var pluginFactory = function ($) {
    "use strict";

    var commandHandlers = {

        "r" : function(context){
            //run saved commands
            var actualCommand = $.trim(context.cmdText.substring(2)) || "";

            $.jsshell.run(actualCommand,context,function(data){
                context.out.resolve(data);
            });
        },
        "h" : function(context){
            //display help
        }
    };

    var pluginMap = {
        echo : function(context){
            if(context.input)
            context.out.resolve(JSON.stringify(context.input));
            else if(context.args)
                context.out.resolve(context.args.join());
            else
                context.out.resolve("");
        },
        wrapstar : function(context){
            context.out.resolve('*'+context.input+'*');
        },
        wrapsb : function(context){
            context.out.resolve('['+context.input+']');
        },
        wraprb : function(context){
            context.out.resolve('('+context.input+')');
        },
        wrapcb : function(context){
            context.out.resolve('{'+context.input+'}');
        },
        dbox   : ":r wrapstar | wrapsb",
        dround : ":r wraprb | wrapcb",
        decorate : ":r dbox | dround"
    };

    $.fn.jsshell = function (options) {

        // Options
        var optionMap = $.extend( {}, $.fn.jsshell.defaults, options);

        var templateHtml = getTemplateHtml(optionMap.template);

        var shellElement = $(templateHtml);

        // Watch for enter event on the text box
        $(shellElement).find(optionMap.input).enterKey(function(event){
            runAll($(this).val());
        });

        //append the shell to parent dom selected
        $(this).append(shellElement);

        //if callback not defined provide default callback
        if(!optionMap.callback){
            optionMap.callback = function(data){
                $(optionMap.output).html(data);
            };
        }

        //if get not defined
        if(!optionMap.get){
            optionMap.get = function(context){
                $.ajax({
                  method: "GET",
                  url: context.url,
                }).done(function( data ) {
                    context.out.resolve(data);
                });
            };
        }

        //if get not defined
        if(!optionMap.post){
            optionMap.post = function(context){
                $.ajax({
                  method: "POST",
                  url: context.url,
                  data: context.input
                }).done(function( data ) {
                    context.out.resolve(data);
                });
            };
        }

        // Utilities
        function runAll(inputText){
            run(inputText,{},optionMap.callback);
        };

        function run(inputText,context,callback){
            context = context || {};
            //load
            var programArray = parseInput(inputText);

            //carry forward context if any
            programArray[0].input = context.input;
            var finalPromise = executeEach(programArray);
            //after all commands are executed
            finalPromise.then(function(data){
                callback.apply(this,[data]);
            });
            return finalPromise;
        };

        //expose globally
        $.jsshell = function(inputText){
            return runAll(inputText);
        };

        $.jsshell.run = function(inputText, context, callback){
            return run(inputText, context, callback);
        };

        function executeEach(programArray){
            var promise;
            var programContext;
            for(var index=0;index<programArray.length;++index){
                //first execution
                if(!promise){
                    promise = execute(programArray[index]);
                } else {
                    programContext = programArray[index];

                    promise = (function(context){

                        promise = promise.then(function(data){
                                        context.input = data;
                                        return execute(context);
                                    });
                        return promise;
                    }(programContext,promise));
                }
            }
            //return final promise
            return promise;
        };

        function execute(program){
            var deferred = $.Deferred();
            //run in async to avoid freezing the browser
            setTimeout(function(){
                executeCommand(program,deferred);
            },0);

            return deferred.promise();
        };

        function executeCommand(program,deferred){
            program.out = deferred;
            //handle strings / internal commands
            if( !!program.cmdText ){
                return executeInternalCommand(program);
            } else {
                //handle functions
                program.fn.apply(this,[program]);
            }
        };

        function executeInternalCommand(context){
            var handler = commandHandlers[context.cmdText[1]];
            if(handler){
                handler.apply(this,[context]);
            } else {
                context.out.fail("Command not found");
            }
        };

        function getTemplateHtml(template){
            //if a function call it
            if(template && template instanceof Function ){
                return template();
            } else {
                //else it is a selector
                return $(template);
            }
        };

        function parseInput(inputText){
            //split and remove each command
            inputText = inputText || "";
            var inputArray = inputText.split('|');
            var commandArray = [];
            //process each command
            for(var index=0;index<inputArray.length;++index){
                commandArray.push(parseCommand(inputArray[index]));
            }

            commandArray = [].concat.apply([], commandArray);
            console.log('commandArray',commandArray);
            return commandArray;
        };

        function parseCommand(commandString){
            var commandPartsArr;
            var command = {};

            commandString = $.trim(commandString) || "";
            if(commandString[0]===":"){
                command.name = 'i';
                command.isInternalCommand = true;
                command.cmdText = commandString;
            } else {
                //is plugin command
                //plugin can be saved inbuilt command (script) or a custom function
                commandPartsArr = commandString.split(" ");
                commandPartsArr = $.grep(commandPartsArr,function(n){ return n == 0 || n });

                var redirectCommandMap = getRedirectionDetails(commandPartsArr);

                if( commandPartsArr.length > 0 ) {
                    command = resolvePlugin(commandPartsArr[0],commandPartsArr);
                }

                //prepend / append with redirection commands if found
                var commandRedirectionArr = [];
                if( redirectCommandMap['get'] ){
                    commandRedirectionArr.push(redirectCommandMap['get']);
                }
                commandRedirectionArr.push(command);
                if( redirectCommandMap['post'] ){
                    commandRedirectionArr.push(redirectCommandMap['post']);
                }

                return commandRedirectionArr.length > 1 ? commandRedirectionArr : command;
            }
            return command;
        };

        function getRedirectionDetails(commandPartsArr){
            var redirectCommandMap = {};
            var partText;
            var method;
            var redirectCommand;
            var url;
            for(var index=1;index<commandPartsArr.length;++index){
                method='';
                partText = $.trim(commandPartsArr[index]);

                if( partText === '>' ){
                    method = 'post';
                } else if( partText === '<' ){
                    method = 'get';
                }

                url = $.trim(commandPartsArr[index+1]);
                if( method && isURL( url ) ){
                    redirectCommand = {};
                    redirectCommand.method = method;
                    redirectCommand.fn     = optionMap[method];
                    redirectCommand.url    = url;
                    redirectCommandMap[method] = redirectCommand;
                }
            }
            return redirectCommandMap;
        }

        function isURL(urlText){
            return urlText && ( !urlText.startsWith("\'") || !urlText.startsWith("\"") );
        };

        //first argument is the command itself
        function resolvePlugin(commandText,args){

            var command = {};
            var pluginValue = pluginMap[commandText];
            command.name = commandText;
            if(pluginValue && pluginValue instanceof Function ){
                command.fn   = pluginValue;
                command.args = args;
            } else if( pluginValue && typeof(pluginValue) === "string" ){
                command.cmdText = pluginValue;
            }

            return command;
        };
    };

    $.fn.jsshell.addPlugin = function(command,value){
        pluginMap[command] = value;
    };

    // Default Options
    $.fn.jsshell.defaults = {
        //html element selector or function returning html string, or
        template : function(){

            return '<div><input placeholder="Command me master" style="width:100%;font-size: 1.5em;" class="jsshell-input" type="text"/><div><div class="jsshell-output" style="margin:25px;"></div></div>'
        },
        //html input text element selector, must be child within template
        input    : ".jsshell-input",
        //output element selector, out will be rendered onto this selector
        output   : ".jsshell-output",
        // //render behaviour is a function, default is fixed at top and opens with keyboard short cut
        // // Input Parameters : Dom element
        // callback function called when data is finally generated
        // callback gets data as paramter
        //callback   : function(data){},
        // < get data from url when used with < operator
        //get        : function(url,context){},
        // > post data to url when used with sink > operator
        //post       : function(url,context){}
    };

};

//load the plugin
// Uses CommonJS, AMD or browser globals to create a jQuery plugin.
(
    function (factory) {
        if (typeof define === 'function' && define.amd) {
            // AMD. Register as an anonymous module.
            define(['jquery'], factory);
        } else if (typeof module === 'object' && module.exports) {
            // Node/CommonJS
            module.exports = function( root, jQuery ) {
                if ( jQuery === undefined ) {
                    // require('jQuery') returns a factory that requires window to
                    // build a jQuery instance, we normalize how we use modules
                    // that require this pattern but the window provided is a noop
                    // if it's defined (how jquery works)
                    if ( typeof window !== 'undefined' ) {
                        jQuery = require('jquery');
                    }
                    else {
                        jQuery = require('jquery')(root);
                    }
                }
                factory(jQuery);
                return jQuery;
            };
        } else {
            // Browser globals
            factory(jQuery);
        }
    }(pluginFactory)
);



/*

var jshell = jshell || {};

var js = js || {};
js.parse = function(command){
    command = command && command.trim();
    if( !command ){
        return;
    }

    //router
    if( command[0] === ':'){
        if( command[1] === 'q' ){
            //query
        } else if(command[1] === 'q' ){

        }
    }
};

js.runCommand = function(){

}
*/
